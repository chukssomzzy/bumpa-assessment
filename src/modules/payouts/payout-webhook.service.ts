import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { ProcessedEventRepository } from '../events/repositories/processed-event.repository';
import { PayoutRepository } from './repositories/payout.repository';
import { PayoutsService } from './payouts.service';

/**
 * Transfer outcomes worth re-driving. Anything else Paystack emits (charges,
 * subscriptions, `transfer.reversed.failed`, …) is not about a payout of ours.
 */
const RECONCILABLE_EVENTS = new Set(['transfer.success', 'transfer.failed', 'transfer.reversed']);

const TERMINAL_STATUSES = new Set(['succeeded', 'failed']);

/**
 * Deliberately permissive. Paystack owns this payload and adds fields to it;
 * rejecting unknown keys would turn a provider release into an outage, and the
 * only fields we act on are these two.
 */
const paystackEventSchema = z.object({
  event: z.string(),
  data: z
    .object({
      reference: z.string().optional(),
      status: z.string().optional(),
    })
    .passthrough(),
});

export type WebhookOutcome =
  | 'malformed'
  | 'ignored-event'
  | 'unknown-reference'
  | 'duplicate'
  | 'already-terminal'
  | 'requeued'
  | 'dispatch-in-flight';

@Injectable()
export class PayoutWebhookService {
  constructor(
    private readonly payoutsRepo: PayoutRepository,
    private readonly receipts: ProcessedEventRepository,
    private readonly payouts: PayoutsService,
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Records a verified Paystack event and re-drives the payout it refers to.
   *
   * Never throws for a payload it cannot use. The caller answers 2xx regardless,
   * because a non-2xx makes Paystack redeliver — so rejecting an event we simply
   * do not care about would earn an unbounded retry storm for no benefit. The
   * outcome is returned instead, for logging and for tests to assert on.
   *
   * This is a latency optimisation, never a correctness dependency: the worker's
   * own `dispatch` reconciles by reference on its next run and the sweeper
   * re-drives anything left behind, so dropping every webhook still settles.
   */
  async handle(body: unknown): Promise<WebhookOutcome> {
    const parsed = paystackEventSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn('paystack webhook payload did not parse');
      return 'malformed';
    }

    const { event, data } = parsed.data;
    if (!RECONCILABLE_EVENTS.has(event)) {
      this.logger.debug({ event }, 'paystack webhook ignored: not a transfer outcome');
      return 'ignored-event';
    }

    const reference = data.reference;
    if (!reference) {
      this.logger.warn({ event }, 'paystack webhook ignored: no reference');
      return 'malformed';
    }

    const payout = await this.payoutsRepo.findByProviderReference(reference);
    if (!payout) {
      // Expected traffic, not an error: the same Paystack account may serve
      // other integrations, and `webhook ping` sends sample references.
      this.logger.info({ event, reference }, 'paystack webhook ignored: unknown reference');
      return 'unknown-reference';
    }

    // The receipt is written BEFORE any action, and its presence is what makes a
    // redelivery a no-op. Paystack retries on any non-2xx or timeout, and sends
    // no event id, so the key is derived from the payload's own identity.
    const receiptKey = `paystack:${event}:${reference}:${data.status ?? 'none'}`;
    const isNewReceipt = await this.receipts.recordEventIfNew(receiptKey);

    if (!isNewReceipt) {
      this.logger.info({ receiptKey }, 'paystack webhook already processed');
      return 'duplicate';
    }

    if (TERMINAL_STATUSES.has(payout.status)) {
      // `dispatch` would early-return anyway; skipping the enqueue just avoids
      // churning the queue for an event that arrived after settlement.
      this.logger.info({ reference, status: payout.status }, 'payout already terminal');
      return 'already-terminal';
    }

    const requeued = await this.payouts.requeue(payout.id);
    this.logger.info({ reference, payoutId: payout.id, requeued }, 'payout reconcile re-driven');
    // A false return means a job is already active for this payout — the right
    // answer, since it is being dispatched right now.
    return requeued ? 'requeued' : 'dispatch-in-flight';
  }
}
