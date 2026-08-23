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
   * Resolves a transfer recipient, transfers, and moves the payout to a terminal
   * state. On an unknown outcome it reconciles by reference before considering a
   * retry, so an already-completed transfer is never repeated. Becomes terminally
   * failed once the configured attempt limit is reached.
   */
  async dispatch(payoutId: string): Promise<void> {
    const payout = await this.payoutsRepo.findOne({ where: { id: payoutId } });
    if (!payout || TERMINAL_STATUSES.includes(payout.status)) return;

    const maxAttempts = this.config.maxAttempts ?? 5;
    if (payout.attempts >= maxAttempts) {
      await this.markFailed(payout.id, payout.lastError ?? 'max attempts reached');
      return;
    }

    // A non-zero attempt count with a non-terminal status means a previous call
    // left the outcome ambiguous (crash, timeout, `unknown`). Reconciling by
    // reference before transferring is what makes a second transfer impossible.
    if (payout.attempts > 0) {
      const reconciled = await this.provider.findTransfer(payout.providerReference);
      if (reconciled?.status === 'succeeded') {
        await this.markSucceeded(payout.id, reconciled.reference);
        return;
      }
      // An inconclusive lookup carries the same ambiguity as the original
      // outcome: money may still have moved, so a fresh transfer is not safe.
      if (reconciled?.status === 'unknown') {
        await this.payoutsRepo.update(payout.id, { lastError: reconciled.reason });
        return;
      }
      // `null` (no such transfer) or a definitive `failed` both mean it is safe
      // to fall through and attempt a real transfer below.
    }

    let recipientCode: string;
    try {
      const user = await this.usersRepo.findOneByOrFail({ id: payout.userId });
      recipientCode = await this.resolveRecipient(user);
    } catch (err) {
      await this.recordRetryableFailure(payout.id, payout.attempts, maxAttempts, message(err));
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
        await this.markSucceeded(payout.id, result.reference);
        return;
      case 'failed':
        if (result.retryable && attempts < maxAttempts) {
          await this.payoutsRepo.update(payout.id, { status: 'pending', lastError: result.reason });
        } else {
          await this.markFailed(payout.id, result.reason);
        }
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

    for (const payout of stale) {
      await this.queue.add('payout', { payoutId: payout.id }, { jobId: payout.id });
    }

    return stale.length;
  }

  /** Resolves a transfer recipient, caching the code on the user row so later payouts skip the call. */
  private async resolveRecipient(user: UserEntity): Promise<string> {
    if (user.recipientCode) return user.recipientCode;
    const code = await this.provider.ensureRecipient(user);
    await this.usersRepo.update(user.id, { recipientCode: code });
    return code;
  }

  private async recordRetryableFailure(
    payoutId: string,
    priorAttempts: number,
    maxAttempts: number,
    reason: string,
  ): Promise<void> {
    const attempts = priorAttempts + 1;
    if (attempts >= maxAttempts) {
      await this.payoutsRepo.update(payoutId, { status: 'failed', attempts, lastError: reason });
    } else {
      await this.payoutsRepo.update(payoutId, { status: 'pending', attempts, lastError: reason });
    }
  }

  private async markSucceeded(payoutId: string, reference: string): Promise<void> {
    await this.payoutsRepo.update(payoutId, {
      status: 'succeeded',
      providerReference: reference,
      lastError: null,
    });
  }

  private async markFailed(payoutId: string, reason: string): Promise<void> {
    await this.payoutsRepo.update(payoutId, { status: 'failed', lastError: reason });
  }
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
