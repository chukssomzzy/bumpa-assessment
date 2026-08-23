import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { Clock } from '../../src/common/clock';
import { EVALUATE_QUEUE, PAYOUT_QUEUE } from '../../src/common/queues';
import { seed } from '../../src/database/seed';
import { FakePaymentProvider } from '../../src/payments/fake.provider';
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
  await app.init();

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
 * re-upserted by the same seed the deployed path uses.
 */
export async function resetDatabase(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    `TRUNCATE "user_achievements", "user_badges", "payouts", "processed_events", "user_progress", "users" RESTART IDENTITY CASCADE`,
  );
  await seed(dataSource);
}

export async function clearQueues(ctx: TestContext): Promise<void> {
  await ctx.evaluateQueue.obliterate({ force: true }).catch(() => undefined);
  await ctx.payoutQueue.obliterate({ force: true }).catch(() => undefined);
}

/** Signs a body exactly as the storefront would. */
export function sign(
  body: string,
  timestamp: number = Math.floor(Date.now() / 1000),
  secret: string = WEBHOOK_SECRET,
): { 'x-signature': string; 'x-timestamp': string } {
  return {
    'x-signature': createHmac('sha512', secret).update(body).digest('hex'),
    'x-timestamp': String(timestamp),
  };
}

/** Polls until both queues are idle, so assertions see settled state. */
export async function drainQueues(ctx: TestContext, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const counts = await Promise.all([
      ctx.evaluateQueue.getJobCounts('waiting', 'active', 'delayed'),
      ctx.payoutQueue.getJobCounts('waiting', 'active', 'delayed'),
    ]);
    const outstanding = counts.reduce(
      (total, c) => total + (c.waiting ?? 0) + (c.active ?? 0) + (c.delayed ?? 0),
      0,
    );
    if (outstanding === 0) return;
    if (Date.now() > deadline) throw new Error('queues did not drain in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

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
