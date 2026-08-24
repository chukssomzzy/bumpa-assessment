import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { PinoLogger } from 'nestjs-pino';
import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { Clock } from '../../common/clock';
import { PAYOUT_QUEUE, type PayoutJob } from '../../common/queues';
import { paymentsConfig } from '../../config/configuration';
import { PaymentProvider } from '../payments/payment-provider';
import { UserRepository } from '../users/repositories/user.repository';
import type { UserEntity } from '../users/user.entity';
import { type PayoutStatus } from './payout.entity';
import { PayoutRepository } from './repositories/payout.repository';

const TERMINAL_STATUSES: readonly PayoutStatus[] = ['succeeded', 'failed'];

@Injectable()
export class PayoutsService {
  constructor(
    private readonly payoutsRepo: PayoutRepository,
    private readonly usersRepo: UserRepository,
    @InjectQueue(PAYOUT_QUEUE) private readonly queue: Queue<PayoutJob>,
    private readonly provider: PaymentProvider,
    private readonly clock: Clock,
    @Inject(paymentsConfig.KEY)
    private readonly config: ConfigType<typeof paymentsConfig>,
    // Every non-success outcome below is logged as well as persisted. Recording
    // a failure only in `payouts.last_error` makes a stuck money path invisible
    // to anything but a manual query — which is exactly how a seed carrying bank
    // details Paystack could not resolve went unnoticed while every payout
    // silently retried.
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Dispatches one pending payout.
   *
   * Reconciles by reference BEFORE consulting the attempts ceiling: a previous
   * call may have left the outcome ambiguous (crash, timeout, `unknown`), and
   * only a definitive answer may ever settle a terminal or fresh-retry
   * decision. If reconciliation is itself `unknown`, the payout must stay
   * non-terminal no matter how many attempts have run — marking it failed
   * without ever looking it up risks recording a transfer that actually
   * landed as failed, and an operator re-driving it would double-pay.
   *
   * A retryable failure throws after persisting `pending`, so BullMQ's own
   * `attempts`/backoff engage instead of relying solely on the 5-minute
   * sweeper. Non-retryable failures and terminal states return normally —
   * throwing there would only burn a pointless retry.
   */
  async dispatch(payoutId: string): Promise<void> {
    const payout = await this.payoutsRepo.findById(payoutId);
    if (!payout || TERMINAL_STATUSES.includes(payout.status)) return;

    const maxAttempts = this.config.maxAttempts ?? 5;

    if (payout.attempts > 0) {
      const reconciled = await this.provider.findTransfer(payout.providerReference);
      if (reconciled?.status === 'succeeded') {
        await this.payoutsRepo.markSucceeded(payout.id);
        return;
      }
      // An inconclusive lookup carries the same ambiguity as the original
      // outcome: money may still have moved, so it must never be treated as
      // if the attempt ceiling had been reached — that would terminally fail
      // a transfer that may in fact have succeeded.
      if (reconciled?.status === 'unknown') {
        this.logger.warn(
          { payoutId: payout.id, reference: payout.providerReference, reason: reconciled.reason },
          'payout reconciliation inconclusive; leaving non-terminal',
        );
        await this.payoutsRepo.recordInconclusiveOutcome(payout.id, reconciled.reason);
        return;
      }
      // `null` (no such transfer) or a definitive `failed` both mean it is
      // safe to fall through — to the attempts ceiling below, and if still
      // under it, to attempt a real transfer.
    }

    if (payout.attempts >= maxAttempts) {
      this.logger.error(
        { payoutId: payout.id, reference: payout.providerReference, attempts: payout.attempts },
        'payout exhausted its attempt ceiling; giving up',
      );
      await this.payoutsRepo.markFailed(payout.id, payout.lastError ?? 'max attempts reached');
      return;
    }

    let recipientCode: string;
    try {
      const user = await this.usersRepo.findByIdOrFail(payout.userId);
      recipientCode = await this.resolveRecipient(user);
    } catch (err) {
      const reason = message(err);
      const attempts = payout.attempts + 1;
      const exhausted = attempts >= maxAttempts;
      this.logger.warn(
        { payoutId: payout.id, reference: payout.providerReference, reason },
        'payout recipient resolution failed',
      );
      await this.payoutsRepo.recordRecipientResolutionFailure(
        payout.id,
        attempts,
        exhausted,
        reason,
      );
      // Same contract as a retryable transfer failure: throw so BullMQ retries
      // with its backoff. Returning normally would complete the job and leave
      // recovery to the sweeper alone.
      if (!exhausted) throw new Error(`payout recipient resolution failed (retryable): ${reason}`);
      return;
    }

    // Written before the network call so a crash mid-transfer is later visible
    // as ambiguous (attempts > 0, non-terminal) rather than as never attempted.
    const attempts = payout.attempts + 1;
    await this.payoutsRepo.markProcessing(payout.id, attempts);

    const result = await this.provider.transfer({
      recipientCode,
      amountKobo: payout.amountKobo,
      reference: payout.providerReference,
    });

    switch (result.status) {
      case 'succeeded':
        await this.payoutsRepo.markSucceeded(payout.id);
        return;
      case 'failed':
        if (result.retryable && attempts < maxAttempts) {
          this.logger.warn(
            {
              payoutId: payout.id,
              reference: payout.providerReference,
              attempts,
              reason: result.reason,
            },
            'payout transfer failed; will retry',
          );
          await this.payoutsRepo.recordRetryableTransferFailure(payout.id, result.reason);
          // Persisted, so the state is safe; now throw so BullMQ's `attempts`/
          // backoff actually engage instead of the job completing cleanly and
          // leaving retry entirely to the 5-minute sweeper.
          throw new Error(`payout dispatch failed (retryable): ${result.reason}`);
        }
        this.logger.error(
          { payoutId: payout.id, reference: payout.providerReference, reason: result.reason },
          'payout transfer failed terminally',
        );
        await this.payoutsRepo.markFailed(payout.id, result.reason);
        return;
      case 'unknown':
        // Leave the row `processing`: the next dispatch reconciles by reference
        // instead of assuming success or failure.
        this.logger.warn(
          { payoutId: payout.id, reference: payout.providerReference, reason: result.reason },
          'payout transfer outcome unknown; money may have moved',
        );
        await this.payoutsRepo.recordInconclusiveOutcome(payout.id, result.reason);
        return;
    }
  }

  /**
   * Re-enqueues payouts left pending beyond the staleness window, measured
   * against the injected clock rather than `Date.now()` so it is testable
   * without sleeping. Never touches a terminal payout.
   */
  async sweepStalePayouts(): Promise<number> {
    const staleAfterSeconds = this.config.staleAfterSeconds ?? 300;
    const cutoff = new Date(this.clock.now().getTime() - staleAfterSeconds * 1000);

    const stale = await this.payoutsRepo.findStaleNonTerminal(cutoff);

    let requeued = 0;
    for (const payout of stale) {
      if (await this.requeue(payout.id)) requeued += 1;
    }

    return requeued;
  }

  /**
   * Re-enqueues one payout, returning whether a job was actually added.
   *
   * The job id is the payout id, which is what stops two workers dispatching the
   * same payout at once. But BullMQ ignores `add()` while a job with that id
   * still exists in ANY state, and completed jobs are retained — so a payout left
   * `processing` by an ambiguous outcome would be stranded forever, since its job
   * completed cleanly and kept the id. Dropping the finished job first restores
   * the recovery path without weakening the dedupe.
   *
   * An active job cannot be removed; that failure is the correct answer — the
   * payout is already being dispatched, so there is nothing to re-enqueue.
   *
   * Public because the Paystack webhook re-drives through exactly this path.
   * Reusing it, rather than introducing a second queue or a distinct job id,
   * is what preserves the one-consumer-per-payout guarantee that makes
   * `dispatch`'s lock-free read-modify-write safe.
   */
  async requeue(payoutId: string): Promise<boolean> {
    const existing = await this.queue.getJob(payoutId);
    if (existing) {
      try {
        await existing.remove();
      } catch {
        return false;
      }
    }
    await this.queue.add('payout', { payoutId }, { jobId: payoutId });
    return true;
  }

  /** Resolves a transfer recipient, caching the code on the user row so later payouts skip the call. */
  private async resolveRecipient(user: UserEntity): Promise<string> {
    if (user.recipientCode) return user.recipientCode;
    const code = await this.provider.ensureRecipient(user);
    await this.usersRepo.cacheRecipientCode(user.id, code);
    return code;
  }
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
