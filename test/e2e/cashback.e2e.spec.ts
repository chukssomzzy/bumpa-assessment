import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import {
  API,
  AchievementsView,
  connectDatabase,
  givenPayableUser,
  readAchievementsView,
  sleep,
  untilView,
  whenEventIsPosted,
  whenPurchaseIsPosted,
} from './fixtures';

/**
 * Drives the composed stack over HTTP — api, worker, migrate, postgres, redis —
 * exactly as a reviewer would. Not run on push: it needs real provider
 * credentials and minutes rather than seconds.
 *
 * Prerequisites: `docker compose up -d --wait`, and WEBHOOK_SECRET matching the
 * stack's .env (loaded automatically by `test/setup/e2e-env.ts`).
 */
describe('Feature: earning badges and cashback from purchases', () => {
  let db: Client;
  let customer: string;

  beforeAll(async () => {
    db = await connectDatabase();
    customer = await givenPayableUser(db, 'E2E Cashback');
  });

  afterAll(async () => {
    await db?.end();
  });

  describe('Scenario: a purchase event arrives unsigned', () => {
    it('Given a running stack, When a purchase is posted with no signature, Then it is rejected as unauthorized', async () => {
      // Given
      const raw = JSON.stringify({
        type: 'purchase.completed',
        eventId: randomUUID(),
        userId: customer,
        occurredAt: new Date().toISOString(),
      });

      // When
      const response = await fetch(`${API}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: raw,
      });

      // Then
      expect(response.status).toBe(401);
    });
  });

  describe('Scenario: a purchase event is signed with the wrong secret', () => {
    it('Given a running stack, When a purchase is signed with a secret the stack does not hold, Then it is rejected as unauthorized', async () => {
      // Given / When
      const response = await whenPurchaseIsPosted(customer, 'not-the-secret');

      // Then
      expect(response.status).toBe(401);
    });
  });

  describe('Scenario: a customer purchases enough to cross a badge threshold', () => {
    it('Given a customer at the Beginner badge, When twelve purchases are ingested, Then the Intermediate badge and its cashback are earned', async () => {
      // Given
      const before = await readAchievementsView(customer);
      expect(before.current_badge).toBe('Beginner');

      // When
      // Twelve purchases crosses the 1, 3, 5 and 10 tiers: four achievements,
      // which is exactly the Intermediate requirement.
      for (let i = 0; i < 12; i++) {
        expect((await whenPurchaseIsPosted(customer)).status).toBe(202);
      }
      const after = await untilView(customer, (v) => v.current_badge === 'Intermediate');

      // Then
      expect(after.unlocked_achievements).toEqual(
        expect.arrayContaining(['First Purchase', '5 Purchases', '10 Purchases']),
      );
      // Only the next tier of the group, never the whole remaining ladder.
      expect(after.next_available_achievements).toEqual(['15 Purchases']);
      expect(after.next_badge).toBe('Advanced');
      expect(after.remaining_to_unlock_next_badge).toBe(4);
    });
  });

  describe('Scenario: the storefront redelivers an event it already sent', () => {
    it('Given a purchase event already ingested and settled, When the identical event is delivered again, Then the customer view is unchanged', async () => {
      // Given
      // The view exposes no raw counter, so settle explicitly rather than racing
      // the worker: the assertion is that a redelivery changes nothing.
      const raw = JSON.stringify({
        type: 'purchase.completed',
        eventId: randomUUID(),
        userId: customer,
        occurredAt: new Date().toISOString(),
      });
      expect((await whenEventIsPosted(raw)).status).toBe(202);
      await sleep(3000);
      const afterFirstDelivery: AchievementsView = await readAchievementsView(customer);

      // When
      expect((await whenEventIsPosted(raw)).status).toBe(202);
      await sleep(3000);

      // Then
      expect(await readAchievementsView(customer)).toEqual(afterFirstDelivery);
    });
  });
});
