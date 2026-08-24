import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DEMO_USER_ID, drainEvaluateQueue, sign } from '../support/application/app-harness';
import { createBddWorld, type BddWorld } from '../support/application/bdd-world';
import {
  postRaw,
  postSigned,
  postUnsigned,
  purchase,
  readAchievementsView,
  readBadgeKeysBeyondBeginner,
  readPayoutRows,
  readProcessedEvents,
  readPurchaseCount,
  readUnlockedKeys,
} from './fixtures';

/**
 * Exercises `POST /events` end to end: HMAC boundary, payload validation, and
 * the resulting achievement/badge/payout state once the evaluation worker
 * settles. Uses `drainEvaluateQueue`, never `drainQueues` — payout dispatch is
 * a separate stub and would never settle.
 */

describe('Feature: ingesting storefront purchase events', () => {
  let world: BddWorld;

  beforeAll(async () => {
    world = await createBddWorld();
    // supertest binds the underlying http.Server lazily, on first request, by
    // calling `.listen(0)`. Firing many requests concurrently (see the
    // concurrency test below) races that lazy bind across Test instances and
    // resets connections. One sequential request first makes the server
    // already-listening for everything that follows.
    await request(world.app.getHttpServer()).get('/__warmup__');
  });

  beforeEach(async () => world.resetScenario());
  afterEach(() => world.verifyScenario());
  afterAll(async () => world?.close());

  // --- the HMAC boundary --------------------------------------------------

  describe('Scenario: a purchase event arrives unsigned', () => {
    it('Given a well-formed purchase event, When it is posted with no signature header, Then it is rejected as unauthenticated', async () => {
      // Given
      const raw = JSON.stringify(purchase());

      // When
      const response = await postUnsigned(world, raw);

      // Then
      expect(response.status).toBe(401);
    });
  });

  describe('Scenario: a purchase event is signed with the wrong secret', () => {
    it('Given a well-formed purchase event, When it is posted signed under a secret the app does not hold, Then it is rejected as unauthenticated', async () => {
      // Given
      const raw = JSON.stringify(purchase());
      const headers = sign(raw, Math.floor(Date.now() / 1000), 'not-the-real-secret');

      // When
      const response = await postRaw(world, raw, headers);

      // Then
      expect(response.status).toBe(401);
    });
  });

  describe('Scenario: the body is altered after it was signed', () => {
    it('Given a signature computed over one body, When a different body is posted under that signature, Then it is rejected as unauthenticated', async () => {
      // Given
      const raw = JSON.stringify(purchase());
      const headers = sign(raw);
      const tampered = JSON.stringify({ ...purchase(), eventId: 'tampered-event-id' });

      // When
      const response = await postRaw(world, tampered, headers);

      // Then
      expect(response.status).toBe(401);
    });
  });

  describe('Scenario: a correctly signed request is replayed long afterwards', () => {
    it('Given a purchase event signed with a timestamp an hour in the past, When it is posted, Then it is rejected as stale', async () => {
      // Given
      const raw = JSON.stringify(purchase());
      const headers = sign(raw, Math.floor(Date.now() / 1000) - 3600);

      // When
      const response = await postRaw(world, raw, headers);

      // Then
      expect(response.status).toBe(401);
    });
  });

  describe('Scenario: a request is signed with a timestamp in the future', () => {
    it('Given a purchase event signed with a timestamp an hour in the future, When it is posted, Then it is rejected as outside the freshness window', async () => {
      // Given
      const raw = JSON.stringify(purchase());
      const headers = sign(raw, Math.floor(Date.now() / 1000) + 3600);

      // When
      const response = await postRaw(world, raw, headers);

      // Then
      expect(response.status).toBe(401);
    });
  });

  describe('Scenario: a correctly signed, fresh request arrives', () => {
    it('Given a well-formed purchase event, When it is posted correctly signed and fresh, Then it is accepted for evaluation', async () => {
      // Given
      const event = purchase();

      // When
      const response = await postSigned(world, event);

      // Then
      expect(response.status).toBe(202);
    });
  });

  // --- payload validation -------------------------------------------------

  describe('Scenario: the event names a user that does not exist', () => {
    it('Given a purchase event for a well-formed user id no user holds, When it is posted correctly signed, Then it is rejected as unprocessable', async () => {
      // Given
      const event = purchase(randomUUID());

      // When
      const response = await postSigned(world, event);

      // Then
      expect(response.status).toBe(422);
    });
  });

  describe('Scenario: the event payload is malformed', () => {
    it('Given payloads missing an event id, naming an unknown type, or carrying an unparseable date, When each is posted correctly signed, Then every one is rejected as unprocessable', async () => {
      // Given
      const malformedPayloads = [
        { ...purchase(), eventId: undefined },
        { ...purchase(), type: 'not.a.real.type' },
        { ...purchase(), occurredAt: 'not-a-date' },
      ];

      // When / Then
      for (const payload of malformedPayloads) {
        const response = await postSigned(world, payload);
        expect(response.status).toBe(422);
      }
    });
  });

  // --- evaluation ---------------------------------------------------------

  describe('Scenario: a single purchase is evaluated', () => {
    it('Given a user with no purchases, When one purchase event is ingested and evaluation settles, Then progress is one and First Purchase is unlocked exactly once', async () => {
      // Given
      const event = purchase();

      // When
      const response = await postSigned(world, event);
      expect(response.status).toBe(202);
      await drainEvaluateQueue(world, 60_000);

      // Then
      expect(await readPurchaseCount(world, DEMO_USER_ID)).toBe(1);
      expect(await readUnlockedKeys(world, DEMO_USER_ID)).toEqual(['first_purchase']);
      const processed = await readProcessedEvents(world, event.eventId);
      expect(processed).toHaveLength(1);
    });
  });

  describe('Scenario: five distinct purchases cross three tiers', () => {
    it('Given a user with no purchases, When five distinct purchase events are ingested and evaluation settles, Then every tier crossed is unlocked', async () => {
      // Given / When
      for (let i = 0; i < 5; i++) {
        const response = await postSigned(world, purchase());
        expect(response.status).toBe(202);
      }
      await drainEvaluateQueue(world, 60_000);

      // Then
      expect(await readPurchaseCount(world, DEMO_USER_ID)).toBe(5);
      expect(await readUnlockedKeys(world, DEMO_USER_ID)).toEqual(
        ['first_purchase', 'five_purchases', 'three_purchases'].sort(),
      );
    });
  });

  describe('Scenario: the storefront redelivers an event it already sent', () => {
    it('Given a purchase event already ingested and evaluated, When the identical event id is delivered a second time, Then progress is still one and only one receipt exists', async () => {
      // Given
      const event = purchase();
      expect((await postSigned(world, event)).status).toBe(202);
      await drainEvaluateQueue(world, 60_000);

      // When
      expect((await postSigned(world, event)).status).toBe(202);
      await drainEvaluateQueue(world, 60_000);

      // Then
      expect(await readPurchaseCount(world, DEMO_USER_ID)).toBe(1);
      const processed = await readProcessedEvents(world, event.eventId);
      expect(processed).toHaveLength(1);
    });
  });

  describe('Scenario: twelve purchases are delivered concurrently', () => {
    it('Given twelve distinct purchase events for one user, When they are posted concurrently and evaluation settles, Then no purchase is lost and exactly one badge payout is minted', async () => {
      // Given
      const events = Array.from({ length: 12 }, () => purchase());

      // When
      // allSettled, not all: the assertion that matters is the DB state after
      // the dust settles, not that every individual socket completed cleanly.
      await Promise.allSettled(events.map((event) => postSigned(world, event)));
      await drainEvaluateQueue(world, 60_000);

      // Then
      expect(await readPurchaseCount(world, DEMO_USER_ID)).toBe(12);
      expect(await readUnlockedKeys(world, DEMO_USER_ID)).toHaveLength(4);
      expect(await readBadgeKeysBeyondBeginner(world, DEMO_USER_ID)).toEqual(['intermediate']);
      expect(await readPayoutRows(world, DEMO_USER_ID)).toHaveLength(1);
    });
  });

  describe('Scenario: a badge is earned through the ingest path', () => {
    it('Given a user with no purchases, When ten purchase events are ingested and evaluation settles, Then the earned badge carries exactly one cashback payout written with it', async () => {
      // Given / When
      for (let i = 0; i < 10; i++) {
        expect((await postSigned(world, purchase())).status).toBe(202);
      }
      await drainEvaluateQueue(world, 60_000);

      // Then
      const badges = await readBadgeKeysBeyondBeginner(world, DEMO_USER_ID);
      const payouts = await readPayoutRows(world, DEMO_USER_ID);

      // The invariant is one payout per earned badge, written with it. Status is
      // deliberately not asserted here: the payout worker is live in this module
      // and may already have dispatched. Lifecycle is covered in
      // payout-dispatch.bdd-spec.ts.
      expect(badges).toEqual(['intermediate']);
      expect(payouts).toHaveLength(1);
      expect(payouts[0].badge_key).toBe('intermediate');
      expect(payouts[0].amount_kobo).toBe(30_000);
      expect(payouts[0].provider_reference).toEqual(expect.any(String));
    });
  });

  describe('Scenario: the zero-requirement beginner badge is already held', () => {
    it('Given a freshly seeded user holding only Beginner, When no purchase event has been ingested, Then no payout row exists for them', async () => {
      // Given
      // The demo user is seeded with Beginner and nothing else; no event posted.

      // When
      const payouts = await readPayoutRows(world, DEMO_USER_ID);

      // Then
      expect(payouts).toHaveLength(0);
    });
  });

  describe('Scenario: an ingested purchase is read back through the API', () => {
    it('Given one purchase event ingested and evaluated, When the achievements endpoint is called for that user, Then the unlocked achievement is visible there', async () => {
      // Given
      expect((await postSigned(world, purchase())).status).toBe(202);
      await drainEvaluateQueue(world, 60_000);

      // When
      const view = await readAchievementsView(world, DEMO_USER_ID);

      // Then
      expect(view.body.unlocked_achievements).toEqual(['First Purchase']);
    });
  });
});
