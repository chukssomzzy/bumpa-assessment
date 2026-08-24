import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { LessThan } from 'typeorm';
import { PayoutEntity } from '../payout.entity';

@Injectable()
export class PayoutRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  findById(payoutId: string): Promise<PayoutEntity | null> {
    return this.txHost.tx.findOne(PayoutEntity, { where: { id: payoutId } });
  }

  findByProviderReference(reference: string): Promise<PayoutEntity | null> {
    return this.txHost.tx.findOne(PayoutEntity, { where: { providerReference: reference } });
  }

  /** Payouts left pending/processing beyond the caller's staleness cutoff. Never a terminal one. */
  findStaleNonTerminal(cutoff: Date): Promise<PayoutEntity[]> {
    return this.txHost.tx.find(PayoutEntity, {
      where: [
        { status: 'pending', updatedAt: LessThan(cutoff) },
        { status: 'processing', updatedAt: LessThan(cutoff) },
      ],
    });
  }

  /**
   * Writes one pending payout for a badge if it doesn't already exist, and
   * returns the row either way — this doubles as the outbox write, in the
   * same transaction as the badge it pays for. `orIgnore` is what makes a
   * retry of the same purchase event safe: `providerReference` is
   * deterministic (`{userId}_{badgeKey}`), so a second attempt at the same
   * insert collides on the unique index instead of minting a duplicate.
   */
  async insertPendingPayoutIfAbsent(params: {
    userId: string;
    badgeKey: string;
    amountKobo: number;
    providerReference: string;
  }): Promise<PayoutEntity> {
    await this.txHost.tx
      .createQueryBuilder()
      .insert()
      .into(PayoutEntity)
      .values({ ...params, status: 'pending', attempts: 0 })
      .orIgnore()
      .execute();

    return this.txHost.tx.findOneOrFail(PayoutEntity, {
      where: { userId: params.userId, badgeKey: params.badgeKey },
    });
  }

  /** Written before the network call so a crash mid-transfer is later visible as ambiguous (attempts > 0, non-terminal) rather than as never attempted. */
  async markProcessing(payoutId: string, attempts: number): Promise<void> {
    await this.txHost.tx.update(PayoutEntity, payoutId, { status: 'processing', attempts });
  }

  /**
   * `providerReference` is never touched here: it is the idempotency key
   * presented to the provider (and carries a unique index), so it must stay
   * exactly what was sent for the row's lifetime. Overwriting it with
   * whatever the provider echoes back would break the reconcile-by-reference
   * lookup a retry after a crash depends on.
   */
  async markSucceeded(payoutId: string): Promise<void> {
    await this.txHost.tx.update(PayoutEntity, payoutId, { status: 'succeeded', lastError: null });
  }

  async markFailed(payoutId: string, reason: string): Promise<void> {
    await this.txHost.tx.update(PayoutEntity, payoutId, { status: 'failed', lastError: reason });
  }

  /** A transfer attempt failed but is retryable; attempts was already recorded by `markProcessing`. */
  async recordRetryableTransferFailure(payoutId: string, reason: string): Promise<void> {
    await this.txHost.tx.update(PayoutEntity, payoutId, { status: 'pending', lastError: reason });
  }

  /**
   * Records a failed recipient-resolution attempt. `exhausted` decides
   * whether the row lands `pending` (BullMQ retries it) or `failed` (the
   * attempt ceiling is reached) — either way `attempts` and the reason are
   * persisted together in the one write.
   */
  async recordRecipientResolutionFailure(
    payoutId: string,
    attempts: number,
    exhausted: boolean,
    reason: string,
  ): Promise<void> {
    await this.txHost.tx.update(PayoutEntity, payoutId, {
      status: exhausted ? 'failed' : 'pending',
      attempts,
      lastError: reason,
    });
  }

  /**
   * An inconclusive provider outcome (reconcile or transfer both answered
   * `unknown`) carries the same ambiguity as before: money may still have
   * moved, so status is deliberately left untouched — only the reason is
   * recorded, for visibility.
   */
  async recordInconclusiveOutcome(payoutId: string, reason: string): Promise<void> {
    await this.txHost.tx.update(PayoutEntity, payoutId, { lastError: reason });
  }
}
