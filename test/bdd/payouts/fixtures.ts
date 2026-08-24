import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PayoutStatus } from '../../../src/modules/payouts/payout.entity';
import {
  DEMO_USER_ID,
  drainEvaluateQueue,
  drainPayoutQueue,
  sign,
  waitFor,
} from '../support/application/app-harness';
import type { BddWorld } from '../support/application/bdd-world';

/**
 * Defaults from `configuration.ts` (unset in the test env, so these apply):
 * cashback 30_000 kobo, max attempts 5, stale-after 300s.
 */
export const MAX_ATTEMPTS = 5;
export const STALE_AFTER_SECONDS = 300;
export const CASHBACK_AMOUNT_KOBO = 30_000;

/** Four achievements (1, 3, 5 and 10 purchases) is the Intermediate badge, and its cashback. */
export const PURCHASES_FOR_INTERMEDIATE = 10;
export const BADGE_KEY = 'intermediate';

/** The storefront's freshness window, from `configuration.ts`'s default. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface PayoutRow {
  id: string;
  user_id: string;
  badge_key: string;
  amount_kobo: number;
  status: PayoutStatus;
  provider_reference: string;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

/** The four columns the webhook scenarios read back off a payout. */
export type PayoutOutcomeRow = Pick<PayoutRow, 'id' | 'status' | 'provider_reference' | 'attempts'>;

// --- payout rows ---------------------------------------------------------

export async function givenPayout(
  world: BddWorld,
  overrides: {
    userId?: string;
    badgeKey?: string;
    amountKobo?: number;
    status?: PayoutStatus;
    providerReference?: string;
    attempts?: number;
    createdAt?: Date;
    updatedAt?: Date;
  } = {},
): Promise<string> {
  const id = randomUUID();
  const createdAt = overrides.createdAt ?? world.clock.now();
  const updatedAt = overrides.updatedAt ?? createdAt;

  await world.dataSource.query(
    `INSERT INTO payouts
       (id, user_id, badge_key, amount_kobo, status, provider_reference, attempts, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      overrides.userId ?? DEMO_USER_ID,
      overrides.badgeKey ?? 'intermediate',
      overrides.amountKobo ?? CASHBACK_AMOUNT_KOBO,
      overrides.status ?? 'pending',
      overrides.providerReference ?? `ref-${randomUUID()}`,
      overrides.attempts ?? 0,
      createdAt,
      updatedAt,
    ],
  );
  return id;
}

export async function readPayout(world: BddWorld, id: string): Promise<PayoutRow> {
  const rows = await world.dataSource.query('SELECT * FROM payouts WHERE id = $1', [id]);
  return rows[0];
}

export async function readPayoutFor(
  world: BddWorld,
  userId: string,
  badgeKey: string,
): Promise<PayoutOutcomeRow> {
  const rows = await world.dataSource.query(
    'SELECT id, status, provider_reference, attempts FROM payouts WHERE user_id = $1 AND badge_key = $2',
    [userId, badgeKey],
  );
  return rows[0];
}

export async function readRecipientCode(world: BddWorld, userId: string): Promise<string | null> {
  const rows = await world.dataSource.query('SELECT recipient_code FROM users WHERE id = $1', [
    userId,
  ]);
  return rows[0]?.recipient_code ?? null;
}

/** Ids of payout jobs currently sitting in the payout queue, in any non-terminal state. */
export async function readQueuedPayoutIds(world: BddWorld): Promise<string[]> {
  const jobs = await world.payoutQueue.getJobs([
    'waiting',
    'active',
    'delayed',
    'failed',
    'completed',
  ]);
  return jobs.map((job) => job.data.payoutId as string);
}

// --- the Paystack webhook -------------------------------------------------

export const paystackEvent = (event: string, reference: string, status: string) => ({
  event,
  data: { reference, status, amount: 30_000, transfer_code: 'TRF_fake' },
});

export function postWebhook(
  world: BddWorld,
  raw: string,
  headers: Record<string, string>,
): request.Test {
  return request(world.app.getHttpServer())
    .post('/webhooks/paystack')
    .set('content-type', 'application/json')
    .set(headers)
    .send(raw);
}

/** Posts a Paystack delivery with no signature header at all. */
export function postUnsignedWebhook(world: BddWorld, raw: string): request.Test {
  return request(world.app.getHttpServer())
    .post('/webhooks/paystack')
    .set('content-type', 'application/json')
    .send(raw);
}

/** Every receipt the webhook handler has written, whatever else `processed_events` holds. */
export async function readPaystackReceipts(world: BddWorld): Promise<string[]> {
  const rows = await world.dataSource.query(
    "SELECT event_id FROM processed_events WHERE event_id LIKE 'paystack:%' ORDER BY event_id",
  );
  return rows.map((row: { event_id: string }) => row.event_id);
}

/** Drives the real ingest path until the badge — and so the payout — is minted. */
export async function givenIntermediateBadgeEarned(world: BddWorld): Promise<void> {
  for (let i = 0; i < PURCHASES_FOR_INTERMEDIATE; i++) {
    const raw = JSON.stringify({
      type: 'purchase.completed',
      eventId: randomUUID(),
      userId: DEMO_USER_ID,
      occurredAt: new Date().toISOString(),
    });
    const response = await request(world.app.getHttpServer())
      .post('/events')
      .set('content-type', 'application/json')
      .set(sign(raw))
      .send(raw);
    expect(response.status).toBe(202);
  }
  await drainEvaluateQueue(world, 60_000);
}

/**
 * A real payout, held non-terminal.
 *
 * The payout worker is live in this module and settles the row within
 * milliseconds of the badge being minted, so the queue is paused first: the job
 * is still enqueued, just never consumed. That is the only way to hold a payout
 * pending without racing the worker. The `pending` assertion is the guard on it
 * — if the pause stopped working this fails loudly instead of quietly testing a
 * payout that had already settled.
 */
export async function givenPendingPayout(world: BddWorld): Promise<PayoutOutcomeRow> {
  await world.payoutQueue.pause();
  await givenIntermediateBadgeEarned(world);

  const payout = await readPayoutFor(world, DEMO_USER_ID, BADGE_KEY);
  expect(payout).toBeDefined();
  expect(payout.status).toBe('pending');
  // `{userId}_{badgeKey}`, the documented reference format. Asserted here so the
  // receipt keys below can be written as literals rather than read back out of
  // the row they are supposed to be predicting.
  expect(payout.provider_reference).toBe(`${DEMO_USER_ID}_${BADGE_KEY}`);
  return payout;
}

/** The same payout, settled the way it settles in life: by the worker transferring it. */
export async function givenSucceededPayout(world: BddWorld): Promise<PayoutOutcomeRow> {
  await givenIntermediateBadgeEarned(world);
  // The badge listener enqueues after the evaluate job completes, so waiting on
  // the queue alone could observe it empty before the job is ever added.
  await waitFor(
    async () => (await readPayoutFor(world, DEMO_USER_ID, BADGE_KEY))?.status === 'succeeded',
  );
  await drainPayoutQueue(world, 60_000);

  const payout = await readPayoutFor(world, DEMO_USER_ID, BADGE_KEY);
  expect(payout.provider_reference).toBe(`${DEMO_USER_ID}_${BADGE_KEY}`);
  return payout;
}

/**
 * Releases the payout queue after `resetScenario()` has already dropped every
 * leftover job. The ordering is load-bearing: resuming first would release a
 * paused job from the previous scenario into a truncate that is still in
 * flight.
 */
export async function givenPayoutQueueRunning(world: BddWorld): Promise<void> {
  await world.payoutQueue.resume();
}
