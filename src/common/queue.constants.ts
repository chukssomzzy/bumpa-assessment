import type { JobsOptions } from 'bullmq';

/**
 * Named, justified job options per queue. Values are unchanged from what was
 * previously inline in `core.module.ts` — this only gives them names and
 * lets the payout queue diverge where the money path demands it.
 */

/** Shared baseline: retried, capped completed history, applied unless a queue overrides it below. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
  // Completed jobs are inert once done; keep a bounded tail for debugging, not forever.
  removeOnComplete: 1000,
  // A failed job that already ran out of retries is still evidence of what went
  // wrong; only the payout queue needs this kept indefinitely, but there is no
  // harm in the evaluate queue keeping the same default.
  removeOnFail: false,
};

/** Evaluation jobs: same baseline, nothing about this queue needs to differ. */
export const EVALUATE_JOB_OPTIONS: JobsOptions = DEFAULT_JOB_OPTIONS;

/**
 * Payout jobs move real money. Every option here is a retry-semantics decision
 * a reviewer needs to be able to check, not an accident of the BullMQ default.
 */
export const PAYOUT_JOB_OPTIONS: JobsOptions = {
  // Five attempts mirrors `PAYOUT_MAX_ATTEMPTS`'s default in configuration.ts:
  // PayoutsService.dispatch() already stops retrying at that count, so the
  // queue's own attempt ceiling should not cut a dispatch off earlier.
  attempts: 5,
  // Exponential, not fixed: a provider outage should be given increasing room
  // to recover rather than being hammered at a constant interval.
  backoff: { type: 'exponential', delay: 1000 },
  // Succeeded payouts carry no further action; bound the history rather than
  // grow it forever.
  removeOnComplete: 1000,
  // Never discard a failed payout job: a failed cashback must stay inspectable
  // (which payout, which user, which error) rather than vanish from Redis.
  removeOnFail: false,
};
