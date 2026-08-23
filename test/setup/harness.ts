import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { Clock } from '../../src/common/clock';
import { EVALUATE_QUEUE, PAYOUT_QUEUE } from '../../src/common/queues';
import { seedDemoUsers } from '../../src/database/seed';
import { FakePaymentProvider } from '../../src/modules/payments/fake.provider';
import { MutableClock } from './mutable-clock';
import { TestAppModule } from './test-app.module';

export interface TestContext {
  app: INestApplication;
  dataSource: DataSource;
  provider: FakePaymentProvider;
  clock: MutableClock;
  evaluateQueue: Queue;
  payoutQueue: Queue;
  close: () => Promise<void>;
}

export const WEBHOOK_SECRET = 'test-webhook-secret';

/** Demo users restored by the seed after every reset. */
export const DEMO_USER_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';

export async function createTestApp(): Promise<TestContext> {
  const clock = new MutableClock();

  const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  // listen(), not just init(): supertest binds the server lazily on first use,
  // so concurrent requests constructed in one tick race that bind and the losers
  // get ECONNRESET. Binding once up front makes the concurrency tests honest.
  await app.listen(0);

  const dataSource = app.get(DataSource);
  const provider = app.get(FakePaymentProvider);
  const evaluateQueue = app.get<Queue>(getQueueToken(EVALUATE_QUEUE));
  const payoutQueue = app.get<Queue>(getQueueToken(PAYOUT_QUEUE));

  return {
    app,
    dataSource,
    provider,
    clock,
    evaluateQueue,
    payoutQueue,
    close: async () => {
      await evaluateQueue.obliterate({ force: true }).catch(() => undefined);
      await payoutQueue.obliterate({ force: true }).catch(() => undefined);
      await app.close();
    },
  };
}

/**
 * Clears all per-user state and restores the seeded demo users. Definitions are
 * deliberately left alone: they are reference data, not fixtures.
 */
export async function resetDatabase(dataSource: DataSource): Promise<void> {
  // TRUNCATE takes an ACCESS EXCLUSIVE lock. A worker job left in flight by the
  // previous test still holds row locks, so Postgres resolves the standoff by
  // killing one side. Retrying is correct: the job finishes in milliseconds and
  // the next attempt gets a clean lock. Surfaced only under CI load.
  for (let attempt = 1; ; attempt++) {
    try {
      await dataSource.query(
        `TRUNCATE "user_achievements", "user_badges", "payouts", "processed_events", "user_progress", "users" RESTART IDENTITY CASCADE`,
      );
      break;
    } catch (error) {
      const code = (error as { driverError?: { code?: string } }).driverError?.code;
      if (code !== DEADLOCK || attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
  await seedDemoUsers(dataSource);
}

const DEADLOCK = '40P01';

/**
 * Removes queued work and waits for anything already running to finish.
 *
 * `obliterate` drops waiting jobs but cannot stop an active one, and an active
 * job holds database row locks — which is what deadlocks a truncate.
 */
export async function clearQueues(ctx: TestContext): Promise<void> {
  await ctx.evaluateQueue.obliterate({ force: true }).catch(() => undefined);
  await ctx.payoutQueue.obliterate({ force: true }).catch(() => undefined);
  await waitForIdle(ctx).catch(() => undefined);
}

/** Resolves once neither queue has an active job. */
async function waitForIdle(ctx: TestContext, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const counts = await Promise.all([
      ctx.evaluateQueue.getJobCounts('active'),
      ctx.payoutQueue.getJobCounts('active'),
    ]);
    if (counts.every((c) => (c.active ?? 0) === 0)) return;
    if (Date.now() > deadline) throw new Error('queues still active');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Signs `{timestamp}.{body}` exactly as the storefront would. */
export function sign(
  body: string,
  timestamp: number = Math.floor(Date.now() / 1000),
  secret: string = WEBHOOK_SECRET,
): { 'x-signature': string; 'x-timestamp': string } {
  return {
    'x-signature': createHmac('sha512', secret).update(`${timestamp}.${body}`).digest('hex'),
    'x-timestamp': String(timestamp),
  };
}

async function drain(queues: Queue[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const counts = await Promise.all(
      queues.map((q) => q.getJobCounts('waiting', 'active', 'delayed')),
    );
    const outstanding = counts.reduce(
      (total, c) => total + (c.waiting ?? 0) + (c.active ?? 0) + (c.delayed ?? 0),
      0,
    );
    if (outstanding === 0) return;
    if (Date.now() > deadline) throw new Error('queues did not drain in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Waits for evaluation work only. Use when payout dispatch is not under test. */
export const drainEvaluateQueue = (ctx: TestContext, timeoutMs = 20_000): Promise<void> =>
  drain([ctx.evaluateQueue], timeoutMs);

export const drainPayoutQueue = (ctx: TestContext, timeoutMs = 20_000): Promise<void> =>
  drain([ctx.payoutQueue], timeoutMs);

/** Polls until both queues are idle, so assertions see settled state. */
export const drainQueues = (ctx: TestContext, timeoutMs = 20_000): Promise<void> =>
  drain([ctx.evaluateQueue, ctx.payoutQueue], timeoutMs);

export async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
