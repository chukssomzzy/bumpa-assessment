import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  DEMO_USER_ID,
  clearQueues,
  createTestApp,
  drainEvaluateQueue,
  resetDatabase,
  sign,
  type TestContext,
} from '../setup/harness';

/**
 * Exercises `POST /events` end to end: HMAC boundary, payload validation, and
 * the resulting achievement/badge/payout state once the evaluation worker
 * settles. Uses `drainEvaluateQueue`, never `drainQueues` — payout dispatch is
 * a separate stub and would never settle.
 */

const purchase = (userId = DEMO_USER_ID, eventId = randomUUID()) => ({
  type: 'purchase.completed' as const,
  eventId,
  userId,
  occurredAt: new Date().toISOString(),
});

/** Signs and posts the exact bytes given to `sign`, so tampering is meaningful. */
function postRaw(ctx: TestContext, raw: string, headers: Record<string, string>): request.Test {
  return request(ctx.app.getHttpServer())
    .post('/events')
    .set('content-type', 'application/json')
    .set(headers)
    .send(raw);
}

/** Posts a validly signed purchase event. */
function postSigned(ctx: TestContext, payload: unknown): request.Test {
  const raw = JSON.stringify(payload);
  return postRaw(ctx, raw, sign(raw));
}

async function purchaseCount(ctx: TestContext, userId: string): Promise<number> {
  const rows = await ctx.dataSource.query(
    'SELECT purchase_count FROM user_progress WHERE user_id = $1',
    [userId],
  );
  return rows[0]?.purchase_count ?? -1;
}

async function unlockedKeys(ctx: TestContext, userId: string): Promise<string[]> {
  const rows = await ctx.dataSource.query(
    'SELECT achievement_key FROM user_achievements WHERE user_id = $1 ORDER BY achievement_key',
    [userId],
  );
  return rows.map((r: { achievement_key: string }) => r.achievement_key);
}

async function badgeKeysBeyondBeginner(ctx: TestContext, userId: string): Promise<string[]> {
  const rows = await ctx.dataSource.query(
    "SELECT badge_key FROM user_badges WHERE user_id = $1 AND badge_key != 'beginner'",
    [userId],
  );
  return rows.map((r: { badge_key: string }) => r.badge_key);
}

async function payoutRows(
  ctx: TestContext,
  userId: string,
): Promise<
  { status: string; amount_kobo: number; provider_reference: string | null; badge_key: string }[]
> {
  return ctx.dataSource.query('SELECT * FROM payouts WHERE user_id = $1', [userId]);
}

describe('POST /events', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    // supertest binds the underlying http.Server lazily, on first request, by
    // calling `.listen(0)`. Firing many requests concurrently (see the
    // concurrency test below) races that lazy bind across Test instances and
    // resets connections. One sequential request first makes the server
    // already-listening for everything that follows.
    await request(ctx.app.getHttpServer()).get('/__warmup__');
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
    await clearQueues(ctx);
  });

  describe('the HMAC boundary', () => {
    it('rejects a request with no signature header', async () => {
      const raw = JSON.stringify(purchase());
      const response = await request(ctx.app.getHttpServer())
        .post('/events')
        .set('content-type', 'application/json')
        .send(raw);

      expect(response.status).toBe(401);
    });

    it('rejects a signature computed with the wrong secret', async () => {
      const raw = JSON.stringify(purchase());
      const headers = sign(raw, Math.floor(Date.now() / 1000), 'not-the-real-secret');
      const response = await postRaw(ctx, raw, headers);

      expect(response.status).toBe(401);
    });

    it('rejects a valid signature over a body that was tampered with afterwards', async () => {
      const raw = JSON.stringify(purchase());
      const headers = sign(raw);
      const tampered = JSON.stringify({ ...purchase(), eventId: 'tampered-event-id' });
      const response = await postRaw(ctx, tampered, headers);

      expect(response.status).toBe(401);
    });

    it('rejects a timestamp far in the past as a replay', async () => {
      const raw = JSON.stringify(purchase());
      const headers = sign(raw, Math.floor(Date.now() / 1000) - 3600);
      const response = await postRaw(ctx, raw, headers);

      expect(response.status).toBe(401);
    });

    it('rejects a timestamp far in the future', async () => {
      const raw = JSON.stringify(purchase());
      const headers = sign(raw, Math.floor(Date.now() / 1000) + 3600);
      const response = await postRaw(ctx, raw, headers);

      expect(response.status).toBe(401);
    });

    it('accepts a correctly signed, fresh request', async () => {
      const response = await postSigned(ctx, purchase());

      expect(response.status).toBe(202);
    });
  });

  describe('payload validation', () => {
    it('rejects an event for a user id that is well-formed but does not exist', async () => {
      const response = await postSigned(ctx, purchase(randomUUID()));

      expect(response.status).toBe(422);
    });

    it('rejects malformed payloads', async () => {
      const malformedPayloads = [
        { ...purchase(), eventId: undefined },
        { ...purchase(), type: 'not.a.real.type' },
        { ...purchase(), occurredAt: 'not-a-date' },
      ];

      for (const payload of malformedPayloads) {
        const response = await postSigned(ctx, payload);
        expect(response.status).toBe(422);
      }
    });
  });

  describe('evaluation', () => {
    it('records one purchase as one unit of progress and unlocks first purchase', async () => {
      const event = purchase();

      const response = await postSigned(ctx, event);
      expect(response.status).toBe(202);
      await drainEvaluateQueue(ctx, 60_000);

      expect(await purchaseCount(ctx, DEMO_USER_ID)).toBe(1);
      expect(await unlockedKeys(ctx, DEMO_USER_ID)).toEqual(['first_purchase']);
      const processed = await ctx.dataSource.query(
        'SELECT event_id FROM processed_events WHERE event_id = $1',
        [event.eventId],
      );
      expect(processed).toHaveLength(1);
    });

    it('unlocks every tier crossed by five distinct purchases', async () => {
      for (let i = 0; i < 5; i++) {
        const response = await postSigned(ctx, purchase());
        expect(response.status).toBe(202);
      }
      await drainEvaluateQueue(ctx, 60_000);

      expect(await purchaseCount(ctx, DEMO_USER_ID)).toBe(5);
      expect(await unlockedKeys(ctx, DEMO_USER_ID)).toEqual(
        ['first_purchase', 'five_purchases', 'three_purchases'].sort(),
      );
    });

    it('never double-counts the same event id delivered twice', async () => {
      const event = purchase();

      expect((await postSigned(ctx, event)).status).toBe(202);
      await drainEvaluateQueue(ctx, 60_000);
      expect((await postSigned(ctx, event)).status).toBe(202);
      await drainEvaluateQueue(ctx, 60_000);

      expect(await purchaseCount(ctx, DEMO_USER_ID)).toBe(1);
      const processed = await ctx.dataSource.query(
        'SELECT event_id FROM processed_events WHERE event_id = $1',
        [event.eventId],
      );
      expect(processed).toHaveLength(1);
    });

    it('loses no purchases and mints exactly one badge payout under concurrent delivery', async () => {
      const events = Array.from({ length: 12 }, () => purchase());

      // allSettled, not all: the assertion that matters is the DB state after
      // the dust settles, not that every individual socket completed cleanly.
      await Promise.allSettled(events.map((event) => postSigned(ctx, event)));
      await drainEvaluateQueue(ctx, 60_000);

      expect(await purchaseCount(ctx, DEMO_USER_ID)).toBe(12);
      expect(await unlockedKeys(ctx, DEMO_USER_ID)).toHaveLength(4);
      expect(await badgeKeysBeyondBeginner(ctx, DEMO_USER_ID)).toEqual(['intermediate']);
      expect(await payoutRows(ctx, DEMO_USER_ID)).toHaveLength(1);
    });

    it('writes a pending cashback payout in the same transaction as the badge it pays for', async () => {
      for (let i = 0; i < 10; i++) {
        expect((await postSigned(ctx, purchase())).status).toBe(202);
      }
      await drainEvaluateQueue(ctx, 60_000);

      const payouts = await payoutRows(ctx, DEMO_USER_ID);
      expect(payouts).toHaveLength(1);
      expect(payouts[0].badge_key).toBe('intermediate');
      expect(payouts[0].status).toBe('pending');
      expect(payouts[0].amount_kobo).toBe(30_000);
      expect(payouts[0].provider_reference).toEqual(expect.any(String));
    });

    it('never produces a payout for the zero-requirement beginner badge', async () => {
      // The demo user is seeded with Beginner and nothing else; no event posted.
      const payouts = await payoutRows(ctx, DEMO_USER_ID);
      expect(payouts).toHaveLength(0);
    });

    it('reflects an ingested purchase in the achievements endpoint once evaluation settles', async () => {
      expect((await postSigned(ctx, purchase())).status).toBe(202);
      await drainEvaluateQueue(ctx, 60_000);

      const view = await request(ctx.app.getHttpServer()).get(
        `/users/${DEMO_USER_ID}/achievements`,
      );

      expect(view.body.unlocked_achievements).toEqual(['First Purchase']);
    });
  });
});
