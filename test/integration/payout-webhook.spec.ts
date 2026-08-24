import { randomUUID } from 'node:crypto';
import type { ConfigType } from '@nestjs/config';
import request from 'supertest';
import { hmacDigest, type HmacScheme } from '../../src/common/security/hmac';
import { paymentsConfig } from '../../src/config/configuration';
import type { PayoutStatus } from '../../src/modules/payouts/payout.entity';
import { paystackScheme } from '../../src/modules/payouts/paystack-signature.guard';
import {
  DEMO_USER_ID,
  clearQueues,
  createTestApp,
  drainEvaluateQueue,
  drainPayoutQueue,
  resetDatabase,
  sign,
  waitFor,
  type TestContext,
} from '../setup/harness';

/**
 * Exercises `POST /webhooks/paystack`: the Paystack signature boundary, and the
 * receipt row that is the only durable evidence a delivery was acted on.
 *
 * Assertions are on the receipt rows and the payout row, never on payout status
 * transitions the live worker also drives — the webhook is an optimisation, so
 * a status change proves nothing about whether the delivery was processed.
 *
 * The guard fails closed with no secret configured, and the integration env sets
 * none, so this file supplies one BEFORE the app boots and then signs with the
 * value the app actually booted with (read back off `paymentsConfig`), rather
 * than with a constant that could silently drift from it.
 */
const PAYSTACK_SECRET_KEY = 'test-paystack-secret-key';
const previousPaystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
process.env.PAYSTACK_SECRET_KEY = PAYSTACK_SECRET_KEY;

/** Four achievements (1, 3, 5 and 10 purchases) is the Intermediate badge, and its cashback. */
const PURCHASES_FOR_INTERMEDIATE = 10;
const BADGE_KEY = 'intermediate';

/** The storefront's freshness window, from `configuration.ts`'s default. */
const WEBHOOK_TOLERANCE_SECONDS = 300;

interface PayoutRow {
  id: string;
  status: PayoutStatus;
  provider_reference: string;
  attempts: number;
}

const paystackEvent = (event: string, reference: string, status: string) => ({
  event,
  data: { reference, status, amount: 30_000, transfer_code: 'TRF_fake' },
});

function postWebhook(ctx: TestContext, raw: string, headers: Record<string, string>): request.Test {
  return request(ctx.app.getHttpServer())
    .post('/webhooks/paystack')
    .set('content-type', 'application/json')
    .set(headers)
    .send(raw);
}

/** Every receipt the webhook handler has written, whatever else `processed_events` holds. */
async function paystackReceipts(ctx: TestContext): Promise<string[]> {
  const rows = await ctx.dataSource.query(
    "SELECT event_id FROM processed_events WHERE event_id LIKE 'paystack:%' ORDER BY event_id",
  );
  return rows.map((row: { event_id: string }) => row.event_id);
}

async function payoutFor(ctx: TestContext, userId: string, badgeKey: string): Promise<PayoutRow> {
  const rows = await ctx.dataSource.query(
    'SELECT id, status, provider_reference, attempts FROM payouts WHERE user_id = $1 AND badge_key = $2',
    [userId, badgeKey],
  );
  return rows[0];
}

/** Drives the real ingest path until the badge — and so the payout — is minted. */
async function earnIntermediateBadge(ctx: TestContext): Promise<void> {
  for (let i = 0; i < PURCHASES_FOR_INTERMEDIATE; i++) {
    const raw = JSON.stringify({
      type: 'purchase.completed',
      eventId: randomUUID(),
      userId: DEMO_USER_ID,
      occurredAt: new Date().toISOString(),
    });
    const response = await request(ctx.app.getHttpServer())
      .post('/events')
      .set('content-type', 'application/json')
      .set(sign(raw))
      .send(raw);
    expect(response.status).toBe(202);
  }
  await drainEvaluateQueue(ctx, 60_000);
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
async function createPendingPayout(ctx: TestContext): Promise<PayoutRow> {
  await ctx.payoutQueue.pause();
  await earnIntermediateBadge(ctx);

  const payout = await payoutFor(ctx, DEMO_USER_ID, BADGE_KEY);
  expect(payout).toBeDefined();
  expect(payout.status).toBe('pending');
  // `{userId}_{badgeKey}`, the documented reference format. Asserted here so the
  // receipt keys below can be written as literals rather than read back out of
  // the row they are supposed to be predicting.
  expect(payout.provider_reference).toBe(`${DEMO_USER_ID}_${BADGE_KEY}`);
  return payout;
}

/** The same payout, settled the way it settles in life: by the worker transferring it. */
async function createSucceededPayout(ctx: TestContext): Promise<PayoutRow> {
  await earnIntermediateBadge(ctx);
  // The badge listener enqueues after the evaluate job completes, so waiting on
  // the queue alone could observe it empty before the job is ever added.
  await waitFor(
    async () => (await payoutFor(ctx, DEMO_USER_ID, BADGE_KEY))?.status === 'succeeded',
  );
  await drainPayoutQueue(ctx, 60_000);

  const payout = await payoutFor(ctx, DEMO_USER_ID, BADGE_KEY);
  expect(payout.provider_reference).toBe(`${DEMO_USER_ID}_${BADGE_KEY}`);
  return payout;
}

describe('POST /webhooks/paystack', () => {
  let ctx: TestContext;
  let scheme: HmacScheme;

  /** Signs the exact bytes given, Paystack's way: the raw body alone. */
  const paystackHeaders = (raw: string): Record<string, string> => ({
    'x-paystack-signature': hmacDigest(scheme, raw),
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    scheme = paystackScheme(ctx.app.get<ConfigType<typeof paymentsConfig>>(paymentsConfig.KEY));
    expect(scheme.secret).toBe(PAYSTACK_SECRET_KEY);
  });

  afterAll(async () => {
    await ctx.payoutQueue.resume().catch(() => undefined);
    await ctx.close();
    if (previousPaystackSecretKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = previousPaystackSecretKey;
  });

  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
    // Drop leftover jobs before resuming: resuming first would release a paused
    // job from the previous test into a truncate that is still in flight.
    await clearQueues(ctx);
    await ctx.payoutQueue.resume();
    ctx.provider.reset();
  });

  describe('the Paystack signature boundary', () => {
    it('rejects a request carrying no signature header', async () => {
      const raw = JSON.stringify(paystackEvent('transfer.success', 'any-reference', 'success'));

      const response = await request(ctx.app.getHttpServer())
        .post('/webhooks/paystack')
        .set('content-type', 'application/json')
        .send(raw);

      expect(response.status).toBe(401);
    });

    it('rejects a signature over {timestamp}.{body}, the storefront scheme, even under the Paystack key', async () => {
      // Same secret, same SHA-512, same header — the ONLY difference is that the
      // storefront binds the timestamp into the signed payload. If the two
      // schemes were interchangeable this would be accepted, and the storefront
      // freshness window would be worth nothing on this endpoint.
      const storefrontShaped: HmacScheme = {
        ...scheme,
        timestamp: { header: 'x-timestamp', toleranceSeconds: WEBHOOK_TOLERANCE_SECONDS },
      };
      const raw = JSON.stringify(paystackEvent('transfer.success', 'any-reference', 'success'));
      const timestamp = String(Math.floor(Date.now() / 1000));

      const response = await postWebhook(ctx, raw, {
        'x-paystack-signature': hmacDigest(storefrontShaped, raw, timestamp),
        'x-timestamp': timestamp,
      });

      expect(response.status).toBe(401);
    });
  });

  describe('once signed', () => {
    it('accepts a transfer for a reference it has never issued without recording a receipt', async () => {
      const raw = JSON.stringify(
        paystackEvent('transfer.success', `${randomUUID()}_${BADGE_KEY}`, 'success'),
      );

      const response = await postWebhook(ctx, raw, paystackHeaders(raw));

      // 2xx on purpose: a non-2xx makes Paystack redeliver forever an event that
      // is not ours to act on.
      expect(response.status).toBe(200);
      expect(await paystackReceipts(ctx)).toEqual([]);
    });

    it('records a receipt keyed by event, reference and status for a payout it recognises', async () => {
      const payout = await createPendingPayout(ctx);
      const raw = JSON.stringify(
        paystackEvent('transfer.success', payout.provider_reference, 'success'),
      );

      const response = await postWebhook(ctx, raw, paystackHeaders(raw));

      expect(response.status).toBe(200);
      expect(await paystackReceipts(ctx)).toEqual([
        `paystack:transfer.success:${DEMO_USER_ID}_${BADGE_KEY}:success`,
      ]);
    });

    it('records exactly one receipt when Paystack redelivers the same event', async () => {
      const payout = await createPendingPayout(ctx);
      const raw = JSON.stringify(
        paystackEvent('transfer.success', payout.provider_reference, 'success'),
      );

      const first = await postWebhook(ctx, raw, paystackHeaders(raw));
      const second = await postWebhook(ctx, raw, paystackHeaders(raw));

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await paystackReceipts(ctx)).toEqual([
        `paystack:transfer.success:${DEMO_USER_ID}_${BADGE_KEY}:success`,
      ]);
    });

    it('records no receipt for an event that is not a transfer outcome', async () => {
      // A real payout's reference, so the only reason to ignore this delivery is
      // the event type — not a reference the system fails to recognise.
      const payout = await createPendingPayout(ctx);
      const raw = JSON.stringify(
        paystackEvent('charge.success', payout.provider_reference, 'success'),
      );

      const response = await postWebhook(ctx, raw, paystackHeaders(raw));

      expect(response.status).toBe(200);
      expect(await paystackReceipts(ctx)).toEqual([]);
    });

    it('never re-drives a payout that has already settled', async () => {
      const settled = await createSucceededPayout(ctx);
      expect(settled.status).toBe('succeeded');
      const transfersBefore = ctx.provider.attempted.length;
      const raw = JSON.stringify(
        paystackEvent('transfer.success', settled.provider_reference, 'success'),
      );

      const response = await postWebhook(ctx, raw, paystackHeaders(raw));
      expect(response.status).toBe(200);
      // If the handler did re-enqueue, the job exists by now; wait it out so the
      // assertions below see whatever it would have done.
      await drainPayoutQueue(ctx, 60_000);

      // The receipt is still written — the delivery was processed, it simply had
      // nothing left to do.
      expect(await paystackReceipts(ctx)).toEqual([
        `paystack:transfer.success:${DEMO_USER_ID}_${BADGE_KEY}:success`,
      ]);
      const after = await payoutFor(ctx, DEMO_USER_ID, BADGE_KEY);
      expect(after.status).toBe(settled.status);
      expect(after.attempts).toBe(settled.attempts);
      // The money assertion: a late webhook must never buy a second transfer.
      expect(ctx.provider.attempted).toHaveLength(transfersBefore);
    });
  });
});
