import { randomUUID } from 'node:crypto';
import { DEMO_USER_ID } from '../support/application/app-harness';
import { createBddWorld, type BddWorld } from '../support/application/bdd-world';
import { PayoutsService } from '../../../src/modules/payouts/payouts.service';
import {
  MAX_ATTEMPTS,
  STALE_AFTER_SECONDS,
  givenPayout,
  readPayout,
  readQueuedPayoutIds,
  readRecipientCode,
} from './fixtures';

/**
 * Drives `PayoutsService` directly, scripting outcomes on `world.provider`
 * (`FakePaymentProvider`). Payout rows are created by direct INSERT so these
 * tests are independent of the event-ingest path.
 *
 * The amount, attempt ceiling and stale window this file leans on are the
 * `configuration.ts` defaults, declared once in `./fixtures`.
 */

describe('Feature: dispatching and sweeping cashback payouts', () => {
  let world: BddWorld;
  let payouts: PayoutsService;

  beforeAll(async () => {
    world = await createBddWorld();
    payouts = world.app.get(PayoutsService);
  });

  beforeEach(async () => world.resetScenario());
  afterEach(() => world.verifyScenario());
  afterAll(async () => world?.close());

  // --- dispatch -----------------------------------------------------------

  describe('Scenario: the provider accepts the transfer first time', () => {
    it('Given a pending payout, When it is dispatched, Then it is marked succeeded against exactly one transfer under its own reference', async () => {
      // Given
      const reference = `ref-${randomUUID()}`;
      const id = await givenPayout(world, { providerReference: reference });

      // When
      await payouts.dispatch(id);

      // Then
      const row = await readPayout(world, id);
      expect(row.status).toBe('succeeded');
      expect(row.provider_reference).toBe(reference);
      expect(world.provider.attempted).toHaveLength(1);
      expect(world.provider.attempted[0].reference).toBe(reference);
    });
  });

  describe('Scenario: an already-succeeded payout is dispatched again', () => {
    it('Given a payout that has already succeeded, When it is dispatched a second time, Then no second transfer is issued and it stays succeeded', async () => {
      // Given
      const id = await givenPayout(world);
      await payouts.dispatch(id);
      expect(world.provider.attempted).toHaveLength(1);

      // When
      await payouts.dispatch(id);

      // Then
      expect(world.provider.attempted).toHaveLength(1);
      expect((await readPayout(world, id)).status).toBe('succeeded');
    });
  });

  describe('Scenario: the provider fails in a way that may succeed later', () => {
    it('Given a provider scripted to fail retryably, When a pending payout is dispatched, Then the row stays non-terminal with the attempt recorded and the call throws so BullMQ retries it', async () => {
      // Given
      world.provider.script({ status: 'failed', reason: 'temporary outage', retryable: true });
      const id = await givenPayout(world);

      // When / Then
      // A retryable failure must throw after persisting state, so the queue's
      // own `attempts`/backoff engage instead of the job completing cleanly.
      await expect(payouts.dispatch(id)).rejects.toThrow('temporary outage');

      const row = await readPayout(world, id);
      expect(row.status).not.toBe('failed');
      expect(row.status).not.toBe('succeeded');
      expect(row.attempts).toBe(1);
    });
  });

  describe('Scenario: the provider rejects the transfer outright', () => {
    it('Given a provider scripted to fail non-retryably, When a pending payout is dispatched, Then the row is marked terminally failed', async () => {
      // Given
      world.provider.script({ status: 'failed', reason: 'invalid recipient', retryable: false });
      const id = await givenPayout(world);

      // When
      await payouts.dispatch(id);

      // Then
      expect((await readPayout(world, id)).status).toBe('failed');
    });
  });

  describe('Scenario: retryable failures exhaust the attempt ceiling', () => {
    it('Given a provider that fails retryably on every attempt, When a payout is dispatched up to the configured limit and once more, Then it is terminally failed at exactly the ceiling and never transferred again', async () => {
      // Given
      const id = await givenPayout(world);
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        world.provider.script({ status: 'failed', reason: 'temporary outage', retryable: true });
      }

      // When
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

      // Then
      const row = await readPayout(world, id);
      expect(row.status).toBe('failed');
      expect(row.attempts).toBe(MAX_ATTEMPTS);
      expect(world.provider.attempted).toHaveLength(MAX_ATTEMPTS);

      // A terminally failed payout is never retried further.
      await payouts.dispatch(id);
      expect(world.provider.attempted).toHaveLength(MAX_ATTEMPTS);
    });
  });

  describe('Scenario: the provider call times out ambiguously', () => {
    it('Given a provider scripted to return an unknown outcome, When the payout is dispatched and then dispatched again, Then the second pass reconciles by reference instead of issuing a second transfer', async () => {
      // Given
      world.provider.script({ status: 'unknown', reason: 'gateway timeout' });
      const id = await givenPayout(world);

      // When
      await payouts.dispatch(id);
      const afterFirst = await readPayout(world, id);
      expect(afterFirst.status).not.toBe('failed');
      expect(world.provider.attempted).toHaveLength(1);

      await payouts.dispatch(id);

      // Then
      expect(world.provider.attempted).toHaveLength(1);
      expect((await readPayout(world, id)).status).toBe('succeeded');
    });
  });

  describe('Scenario: a second payout is dispatched for a user already resolved', () => {
    it('Given one payout dispatched for a user, When a second payout for that same user is dispatched with recipient resolution rigged to throw, Then the cached recipient code is reused and the payout still succeeds', async () => {
      // Given
      const first = await givenPayout(world, { badgeKey: 'intermediate' });
      await payouts.dispatch(first);

      const cachedCode = await readRecipientCode(world, DEMO_USER_ID);
      expect(cachedCode).toEqual(expect.any(String));

      // If dispatch tried to re-resolve, this would throw and the second payout
      // would fail; a caching implementation never calls ensureRecipient again.
      world.provider.failRecipientResolution(
        new Error('recipient resolution must not be called again'),
      );
      const second = await givenPayout(world, { badgeKey: 'advanced' });

      // When
      await payouts.dispatch(second);

      // Then
      expect((await readPayout(world, second)).status).toBe('succeeded');
      expect(world.provider.attempted).toHaveLength(2);
      expect(world.provider.attempted[1].recipientCode).toBe(
        world.provider.attempted[0].recipientCode,
      );
    });
  });

  // --- sweepStalePayouts --------------------------------------------------

  describe('Scenario: one pending payout is stale and another is fresh', () => {
    it('Given a payout left pending beyond the stale window alongside a fresh one, When the sweeper runs, Then only the stale payout is re-enqueued', async () => {
      // Given
      const anchor = world.clock.now();
      const staleId = await givenPayout(world, {
        badgeKey: 'intermediate',
        status: 'pending',
        createdAt: anchor,
        updatedAt: anchor,
      });

      world.clock.advanceSeconds(STALE_AFTER_SECONDS + 1);
      const freshAnchor = world.clock.now();
      const freshId = await givenPayout(world, {
        badgeKey: 'advanced',
        status: 'pending',
        createdAt: freshAnchor,
        updatedAt: freshAnchor,
      });

      // When
      const requeued = await payouts.sweepStalePayouts();

      // Then
      expect(requeued).toBe(1);
      const queued = await readQueuedPayoutIds(world);
      expect(queued).toContain(staleId);
      expect(queued).not.toContain(freshId);
    });
  });

  describe('Scenario: the only old payouts have already settled', () => {
    it('Given a failed and a succeeded payout both older than the stale window, When the sweeper runs, Then neither is reclaimed', async () => {
      // Given
      const anchor = world.clock.now();
      const failedId = await givenPayout(world, {
        badgeKey: 'intermediate',
        status: 'failed',
        createdAt: anchor,
        updatedAt: anchor,
      });
      const succeededId = await givenPayout(world, {
        badgeKey: 'advanced',
        status: 'succeeded',
        createdAt: anchor,
        updatedAt: anchor,
      });

      world.clock.advanceSeconds(STALE_AFTER_SECONDS + 1);

      // When
      const requeued = await payouts.sweepStalePayouts();

      // Then
      expect(requeued).toBe(0);
      const queued = await readQueuedPayoutIds(world);
      expect(queued).not.toContain(failedId);
      expect(queued).not.toContain(succeededId);
    });
  });
});
