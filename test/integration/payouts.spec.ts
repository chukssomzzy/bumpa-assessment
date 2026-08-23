import { randomUUID } from 'node:crypto';
import { DEMO_USER_ID, createTestApp, resetDatabase, type TestContext } from '../setup/harness';
import { PayoutsService } from '../../src/modules/payouts/payouts.service';
import type { PayoutStatus } from '../../src/modules/payouts/payout.entity';

/**
 * Drives `PayoutsService` directly, scripting outcomes on `ctx.provider`
 * (`FakePaymentProvider`). Payout rows are created by direct INSERT so these
 * tests are independent of the event-ingest path.
 *
 * Defaults from `configuration.ts` (unset in the test env, so these apply):
 * cashback 30_000 kobo, max attempts 5, stale-after 300s.
 */

const MAX_ATTEMPTS = 5;
const STALE_AFTER_SECONDS = 300;
const CASHBACK_AMOUNT_KOBO = 30_000;

interface PayoutRow {
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

async function insertPayout(
  ctx: TestContext,
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
  const createdAt = overrides.createdAt ?? ctx.clock.now();
  const updatedAt = overrides.updatedAt ?? createdAt;

  await ctx.dataSource.query(
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

async function getPayout(ctx: TestContext, id: string): Promise<PayoutRow> {
  const rows = await ctx.dataSource.query('SELECT * FROM payouts WHERE id = $1', [id]);
  return rows[0];
}

async function getRecipientCode(ctx: TestContext, userId: string): Promise<string | null> {
  const rows = await ctx.dataSource.query('SELECT recipient_code FROM users WHERE id = $1', [
    userId,
  ]);
  return rows[0]?.recipient_code ?? null;
}

/** Ids of payout jobs currently sitting in the payout queue, in any non-terminal state. */
async function queuedPayoutIds(ctx: TestContext): Promise<string[]> {
  const jobs = await ctx.payoutQueue.getJobs([
    'waiting',
    'active',
    'delayed',
    'failed',
    'completed',
  ]);
  return jobs.map((job) => job.data.payoutId as string);
}

describe('PayoutsService', () => {
  let ctx: TestContext;
  let payouts: PayoutsService;

  beforeAll(async () => {
    ctx = await createTestApp();
    payouts = ctx.app.get(PayoutsService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
    ctx.provider.reset();
    await ctx.payoutQueue.obliterate({ force: true }).catch(() => undefined);
  });

  describe('dispatch', () => {
    it('marks a payout succeeded and records the provider reference after one transfer', async () => {
      const reference = `ref-${randomUUID()}`;
      const id = await insertPayout(ctx, { providerReference: reference });

      await payouts.dispatch(id);

      const row = await getPayout(ctx, id);
      expect(row.status).toBe('succeeded');
      expect(row.provider_reference).toBe(reference);
      expect(ctx.provider.attempted).toHaveLength(1);
      expect(ctx.provider.attempted[0].reference).toBe(reference);
    });

    it('does not re-transfer a payout that has already succeeded', async () => {
      const id = await insertPayout(ctx);
      await payouts.dispatch(id);
      expect(ctx.provider.attempted).toHaveLength(1);

      await payouts.dispatch(id);

      expect(ctx.provider.attempted).toHaveLength(1);
      expect((await getPayout(ctx, id)).status).toBe('succeeded');
    });

    it('leaves a retryable failure non-terminal, records the attempt, and throws so BullMQ retries it', async () => {
      ctx.provider.script({ status: 'failed', reason: 'temporary outage', retryable: true });
      const id = await insertPayout(ctx);

      // A retryable failure must throw after persisting state, so the queue's
      // own `attempts`/backoff engage instead of the job completing cleanly.
      await expect(payouts.dispatch(id)).rejects.toThrow('temporary outage');

      const row = await getPayout(ctx, id);
      expect(row.status).not.toBe('failed');
      expect(row.status).not.toBe('succeeded');
      expect(row.attempts).toBe(1);
    });

    it('marks a non-retryable failure terminally failed', async () => {
      ctx.provider.script({ status: 'failed', reason: 'invalid recipient', retryable: false });
      const id = await insertPayout(ctx);

      await payouts.dispatch(id);

      expect((await getPayout(ctx, id)).status).toBe('failed');
    });

    it('gives up permanently once the configured attempt limit is reached', async () => {
      const id = await insertPayout(ctx);
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        ctx.provider.script({ status: 'failed', reason: 'temporary outage', retryable: true });
      }

      // Every attempt but the last is retryable, so it throws (BullMQ's retry
      // signal) after persisting `pending`; the final attempt exhausts the
      // ceiling and returns normally with the row terminally failed instead.
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        if (i < MAX_ATTEMPTS - 1) {
          await expect(payouts.dispatch(id)).rejects.toThrow('temporary outage');
        } else {
          await payouts.dispatch(id);
        }
      }

      const row = await getPayout(ctx, id);
      expect(row.status).toBe('failed');
      expect(row.attempts).toBe(MAX_ATTEMPTS);
      expect(ctx.provider.attempted).toHaveLength(MAX_ATTEMPTS);

      // A terminally failed payout is never retried further.
      await payouts.dispatch(id);
      expect(ctx.provider.attempted).toHaveLength(MAX_ATTEMPTS);
    });

    it('reconciles an ambiguous timeout by reference instead of issuing a second transfer', async () => {
      ctx.provider.script({ status: 'unknown', reason: 'gateway timeout' });
      const id = await insertPayout(ctx);

      await payouts.dispatch(id);
      const afterFirst = await getPayout(ctx, id);
      expect(afterFirst.status).not.toBe('failed');
      expect(ctx.provider.attempted).toHaveLength(1);

      await payouts.dispatch(id);

      expect(ctx.provider.attempted).toHaveLength(1);
      expect((await getPayout(ctx, id)).status).toBe('succeeded');
    });

    it('resolves the recipient once per user and reuses the cached code for later payouts', async () => {
      const first = await insertPayout(ctx, { badgeKey: 'intermediate' });
      await payouts.dispatch(first);

      const cachedCode = await getRecipientCode(ctx, DEMO_USER_ID);
      expect(cachedCode).toEqual(expect.any(String));

      // If dispatch tried to re-resolve, this would throw and the second payout
      // would fail; a caching implementation never calls ensureRecipient again.
      ctx.provider.failRecipientResolution(
        new Error('recipient resolution must not be called again'),
      );
      const second = await insertPayout(ctx, { badgeKey: 'advanced' });
      await payouts.dispatch(second);

      expect((await getPayout(ctx, second)).status).toBe('succeeded');
      expect(ctx.provider.attempted).toHaveLength(2);
      expect(ctx.provider.attempted[1].recipientCode).toBe(ctx.provider.attempted[0].recipientCode);
    });
  });

  describe('sweepStalePayouts', () => {
    it('re-enqueues a payout left pending beyond the stale window but not a fresh one', async () => {
      const anchor = ctx.clock.now();
      const staleId = await insertPayout(ctx, {
        badgeKey: 'intermediate',
        status: 'pending',
        createdAt: anchor,
        updatedAt: anchor,
      });

      ctx.clock.advanceSeconds(STALE_AFTER_SECONDS + 1);
      const freshAnchor = ctx.clock.now();
      const freshId = await insertPayout(ctx, {
        badgeKey: 'advanced',
        status: 'pending',
        createdAt: freshAnchor,
        updatedAt: freshAnchor,
      });

      const requeued = await payouts.sweepStalePayouts();

      expect(requeued).toBe(1);
      const queued = await queuedPayoutIds(ctx);
      expect(queued).toContain(staleId);
      expect(queued).not.toContain(freshId);
    });

    it('never reclaims a payout that is already terminal', async () => {
      const anchor = ctx.clock.now();
      const failedId = await insertPayout(ctx, {
        badgeKey: 'intermediate',
        status: 'failed',
        createdAt: anchor,
        updatedAt: anchor,
      });
      const succeededId = await insertPayout(ctx, {
        badgeKey: 'advanced',
        status: 'succeeded',
        createdAt: anchor,
        updatedAt: anchor,
      });

      ctx.clock.advanceSeconds(STALE_AFTER_SECONDS + 1);

      const requeued = await payouts.sweepStalePayouts();

      expect(requeued).toBe(0);
      const queued = await queuedPayoutIds(ctx);
      expect(queued).not.toContain(failedId);
      expect(queued).not.toContain(succeededId);
    });
  });
});
