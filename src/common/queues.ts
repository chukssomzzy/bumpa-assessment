export const EVALUATE_QUEUE = 'evaluate';
export const PAYOUT_QUEUE = 'payout';

/** Payload of an evaluation job: one purchase event to apply. */
export interface EvaluateJob {
  eventId: string;
  userId: string;
  occurredAt: string;
}

/** Payload of a payout job: one pending payout row to dispatch. */
export interface PayoutJob {
  payoutId: string;
}
