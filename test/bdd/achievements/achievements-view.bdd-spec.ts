import { randomUUID } from 'node:crypto';
import { DEMO_USER_ID, OTHER_USER_ID } from '../support/application/app-harness';
import { createBddWorld, type BddWorld } from '../support/application/bdd-world';
import {
  ACHIEVEMENT_KEYS_IN_TIER_ORDER,
  givenBadges,
  givenPurchaseCount,
  givenUnlockedAchievements,
  readAchievements,
  type AchievementsView,
} from './fixtures';

/**
 * The read model, exercised by inserting rows directly rather than through the
 * event path. `first_purchase` etc. below are the seeded keys from
 * `definitions.ts`; the achievement's threshold on `purchase_count` is kept in
 * step with the achievements unlocked, since that is the only state the write
 * path can ever actually produce.
 */

describe("Feature: viewing a user's achievements, badges and progress", () => {
  let world: BddWorld;

  beforeAll(async () => {
    world = await createBddWorld();
  });

  beforeEach(async () => world.resetScenario());
  afterEach(() => world.verifyScenario());
  afterAll(async () => world?.close());

  describe('Scenario: a freshly seeded user has done nothing yet', () => {
    it('Given a user seeded with no purchases, When their achievements are requested, Then nothing is unlocked and only First Purchase is offered next', async () => {
      // Given
      // (the seed leaves OTHER_USER_ID with no progress at all)

      // When
      const response = await readAchievements(world, OTHER_USER_ID);

      // Then
      expect(response.status).toBe(200);
      const body = response.body as AchievementsView;
      expect(body.unlocked_achievements).toEqual([]);
      expect(body.next_available_achievements).toEqual(['First Purchase']);
      expect(body.current_badge).toBe('Beginner');
      expect(body.next_badge).toBe('Intermediate');
      expect(body.remaining_to_unlock_next_badge).toBe(4);
    });
  });

  describe('Scenario: the first tier of the purchases group is already unlocked', () => {
    it('Given a user with one purchase and First Purchase unlocked, When their achievements are requested, Then only the next tier of that group is offered', async () => {
      // Given
      await givenPurchaseCount(world, DEMO_USER_ID, 1);
      await givenUnlockedAchievements(world, DEMO_USER_ID, ['first_purchase']);

      // When
      const response = await readAchievements(world, DEMO_USER_ID);

      // Then
      const body = response.body as AchievementsView;
      // Exactly one entry: the single group's next tier, never the remaining ten.
      expect(body.next_available_achievements).toEqual(['3 Purchases']);
      expect(body.next_available_achievements).toHaveLength(1);
    });
  });

  describe('Scenario: four achievements have been unlocked', () => {
    it('Given a user holding the Intermediate badge and its four achievements, When their achievements are requested, Then Intermediate is current and Advanced is four away', async () => {
      // Given
      await givenPurchaseCount(world, DEMO_USER_ID, 10);
      await givenUnlockedAchievements(
        world,
        DEMO_USER_ID,
        ACHIEVEMENT_KEYS_IN_TIER_ORDER.slice(0, 4),
      );
      await givenBadges(world, DEMO_USER_ID, ['intermediate']);

      // When
      const response = await readAchievements(world, DEMO_USER_ID);

      // Then
      const body = response.body as AchievementsView;
      expect(body.current_badge).toBe('Intermediate');
      expect(body.next_badge).toBe('Advanced');
      expect(body.remaining_to_unlock_next_badge).toBe(4);
    });
  });

  describe('Scenario: the Advanced rung of the badge ladder has been reached', () => {
    it('Given a user holding Advanced and its eight achievements, When their achievements are requested, Then Elite is reported as four achievements away', async () => {
      // Given
      await givenPurchaseCount(world, DEMO_USER_ID, 50);
      await givenUnlockedAchievements(
        world,
        DEMO_USER_ID,
        ACHIEVEMENT_KEYS_IN_TIER_ORDER.slice(0, 8),
      );
      await givenBadges(world, DEMO_USER_ID, ['intermediate', 'advanced']);

      // When
      const response = await readAchievements(world, DEMO_USER_ID);

      // Then
      const body = response.body as AchievementsView;
      expect(body.current_badge).toBe('Advanced');
      expect(body.next_badge).toBe('Elite');
      expect(body.remaining_to_unlock_next_badge).toBe(4);
    });
  });

  describe('Scenario: the whole ladder is complete', () => {
    it('Given a user holding every achievement and every badge, When their achievements are requested, Then there is no next badge and nothing left to unlock', async () => {
      // Given
      await givenPurchaseCount(world, DEMO_USER_ID, 200);
      await givenUnlockedAchievements(world, DEMO_USER_ID, ACHIEVEMENT_KEYS_IN_TIER_ORDER);
      await givenBadges(world, DEMO_USER_ID, ['intermediate', 'advanced', 'elite']);

      // When
      const response = await readAchievements(world, DEMO_USER_ID);

      // Then
      const body = response.body as AchievementsView;
      expect(body.next_badge).toBeNull();
      expect(body.remaining_to_unlock_next_badge).toBe(0);
      expect(body.next_available_achievements).toEqual([]);
      expect(body.unlocked_achievements).toHaveLength(ACHIEVEMENT_KEYS_IN_TIER_ORDER.length);
    });
  });

  describe('Scenario: achievements were unlocked out of tier order', () => {
    it('Given achievements inserted out of tier order, When their achievements are requested, Then names, not keys, come back ordered by tier', async () => {
      // Given
      await givenPurchaseCount(world, DEMO_USER_ID, 5);
      // Unlocked out of tier order: the response must not merely echo insertion order.
      await givenUnlockedAchievements(world, DEMO_USER_ID, [
        'three_purchases',
        'first_purchase',
        'five_purchases',
      ]);

      // When
      const response = await readAchievements(world, DEMO_USER_ID);

      // Then
      const body = response.body as AchievementsView;
      expect(body.unlocked_achievements).toEqual(['First Purchase', '3 Purchases', '5 Purchases']);
    });
  });

  describe('Scenario: the requested user does not exist', () => {
    it('Given a well-formed user id that no user holds, When their achievements are requested, Then the view is reported as not found', async () => {
      // Given
      const unknownUserId = randomUUID();

      // When
      const response = await readAchievements(world, unknownUserId);

      // Then
      expect(response.status).toBe(404);
    });
  });

  describe('Scenario: the requested user id is not a uuid', () => {
    it('Given a user id that is not a uuid, When their achievements are requested, Then the request is rejected as malformed', async () => {
      // Given
      const malformedUserId = 'not-a-uuid';

      // When
      const response = await readAchievements(world, malformedUserId);

      // Then
      expect(response.status).toBe(400);
    });
  });

  describe('Scenario: two users have different progress', () => {
    it("Given one user with four achievements and a badge, When a different user's achievements are requested, Then none of the first user's state appears in the second's view", async () => {
      // Given
      await givenPurchaseCount(world, DEMO_USER_ID, 10);
      await givenUnlockedAchievements(
        world,
        DEMO_USER_ID,
        ACHIEVEMENT_KEYS_IN_TIER_ORDER.slice(0, 4),
      );
      await givenBadges(world, DEMO_USER_ID, ['intermediate']);

      // When
      const other = await readAchievements(world, OTHER_USER_ID);

      // Then
      const body = other.body as AchievementsView;
      expect(body.unlocked_achievements).toEqual([]);
      expect(body.current_badge).toBe('Beginner');
      expect(body.next_available_achievements).toEqual(['First Purchase']);
    });
  });
});
