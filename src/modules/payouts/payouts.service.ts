import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { LessThan, Repository } from 'typeorm';
import { Clock } from '../../common/clock';
import { PAYOUT_QUEUE, type PayoutJob } from '../../common/queues';
import { paymentsConfig } from '../../config/configuration';
import { PaymentProvider } from '../payments/payment-provider';
import { UserEntity } from '../users/user.entity';
import { PayoutEntity, type PayoutStatus } from './payout.entity';

const TERMINAL_STATUSES: readonly PayoutStatus[] = ['succeeded', 'failed'];

@Injectable()
export class PayoutsService {
  constructor(
    @InjectRepository(PayoutEntity) private readonly payoutsRepo: Repository<PayoutEntity>,
    @InjectRepository(UserEntity) private readonly usersRepo: Repository<UserEntity>,
    @InjectQueue(PAYOUT_QUEUE) private readonly queue: Queue<PayoutJob>,
    private readonly provider: PaymentProvider,
    private readonly clock: Clock,
    @Inject(paymentsConfig.KEY)
    private readonly config: ConfigType<typeof paymentsConfig>,
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
    const payout = await this.payoutsRepo.findOne({ where: { id: payoutId } });
    if (!payout || TERMINAL_STATUSES.includes(payout.status)) return;

    const maxAttempts = this.config.maxAttempts ?? 5;

    if (payout.attempts > 0) {
      const reconciled = await this.provider.findTransfer(payout.providerReference);
      if (reconciled?.status === 'succeeded') {
        await this.markSucceeded(payout.id);
        return;
      }
      // An inconclusive lookup carries the same ambiguity as the original
      // outcome: money may still have moved, so it must never be treated as
      // if the attempt ceiling had been reached — that would terminally fail
      // a transfer that may in fact have succeeded.
      if (reconciled?.status === 'unknown') {
        await this.payoutsRepo.update(payout.id, { lastError: reconciled.reason });
        return;
      }
      // `null` (no such transfer) or a definitive `failed` both mean it is
      // safe to fall through — to the attempts ceiling below, and if still
      // under it, to attempt a real transfer.
    }

    if (payout.attempts >= maxAttempts) {
      await this.markFailed(payout.id, payout.lastError ?? 'max attempts reached');
      return;
    }

    let recipientCode: string;
    try {
      const user = await this.usersRepo.findOneByOrFail({ id: payout.userId });
      recipientCode = await this.resolveRecipient(user);
    } catch (err) {
      const reason = message(err);
      const exhausted = await this.recordRetryableFailure(
        payout.id,
        payout.attempts,
        maxAttempts,
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
    await this.payoutsRepo.update(payout.id, { status: 'processing', attempts });

    const result = await this.provider.transfer({
      recipientCode,
      amountKobo: payout.amountKobo,
      reference: payout.providerReference,
    });

    switch (result.status) {
      case 'succeeded':
        await this.markSucceeded(payout.id);
        return;
      case 'failed':
        if (result.retryable && attempts < maxAttempts) {
          await this.payoutsRepo.update(payout.id, { status: 'pending', lastError: result.reason });
          // Persisted, so the state is safe; now throw so BullMQ's `attempts`/
          // backoff actually engage instead of the job completing cleanly and
          // leaving retry entirely to the 5-minute sweeper.
          throw new Error(`payout dispatch failed (retryable): ${result.reason}`);
        }
        await this.markFailed(payout.id, result.reason);
        return;
      case 'unknown':
        // Leave the row `processing`: the next dispatch reconciles by reference
        // instead of assuming success or failure.
        await this.payoutsRepo.update(payout.id, { lastError: result.reason });
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

    const stale = await this.payoutsRepo.find({
      where: [
        { status: 'pending', updatedAt: LessThan(cutoff) },
        { status: 'processing', updatedAt: LessThan(cutoff) },
      ],
    });

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
   */
  private async requeue(payoutId: string): Promise<boolean> {
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
    await this.usersRepo.update(user.id, { recipientCode: code });
    return code;
  }

  /** Records a retryable failure. Returns whether the attempt ceiling is now exhausted. */
  private async recordRetryableFailure(
    payoutId: string,
    priorAttempts: number,
    maxAttempts: number,
    reason: string,
  ): Promise<boolean> {
    const attempts = priorAttempts + 1;
    const exhausted = attempts >= maxAttempts;
    await this.payoutsRepo.update(payoutId, {
      status: exhausted ? 'failed' : 'pending',
      attempts,
      lastError: reason,
    });
    return exhausted;
  }

  /**
   * `providerReference` is never overwritten here: it is the idempotency key
   * presented to the provider (and carries a unique index), so it must stay
   * exactly what was sent for the row's lifetime. Replacing it with whatever
   * the provider echoes back would break the reconcile-by-reference lookup a
   * retry after a crash depends on.
   */
  private async markSucceeded(payoutId: string): Promise<void> {
    await this.payoutsRepo.update(payoutId, { status: 'succeeded', lastError: null });
  }

  private async markFailed(payoutId: string, reason: string): Promise<void> {
    await this.payoutsRepo.update(payoutId, { status: 'failed', lastError: reason });
  }
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
