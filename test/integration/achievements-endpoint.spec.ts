import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  DEMO_USER_ID,
  OTHER_USER_ID,
  createTestApp,
  resetDatabase,
  type TestContext,
} from '../setup/harness';

/**
 * The read model, exercised by inserting rows directly rather than through the
 * event path. `first_purchase` etc. below are the seeded keys from
 * `definitions.ts`; the achievement's threshold on `purchase_count` is kept in
 * step with the achievements unlocked, since that is the only state the write
 * path can ever actually produce.
 */

interface AchievementsView {
  unlocked_achievements: string[];
  next_available_achievements: string[];
  current_badge: string;
  next_badge: string | null;
  remaining_to_unlock_next_badge: number;
}

const ACHIEVEMENT_KEYS_IN_TIER_ORDER = [
  'first_purchase',
  'three_purchases',
  'five_purchases',
  'ten_purchases',
  'fifteen_purchases',
  'twenty_purchases',
  'twentyfive_purchases',
  'fifty_purchases',
  'seventyfive_purchases',
  'hundred_purchases',
  'onefifty_purchases',
  'twohundred_purchases',
];

/** Sets purchase_count on the seeded user_progress row (never inserts: the seed already owns it). */
async function setPurchaseCount(ctx: TestContext, userId: string, count: number): Promise<void> {
  await ctx.dataSource.query('UPDATE user_progress SET purchase_count = $2 WHERE user_id = $1', [
    userId,
    count,
  ]);
}

/**
 * Unlocks achievements one statement at a time, in the order given, so
 * `unlocked_at` strictly increases and ordering assertions are meaningful.
 */
async function unlockAchievements(ctx: TestContext, userId: string, keys: string[]): Promise<void> {
  for (const key of keys) {
    await ctx.dataSource.query(
      'INSERT INTO user_achievements (user_id, achievement_key) VALUES ($1, $2)',
      [userId, key],
    );
  }
}

/** Grants badges beyond the seeded `beginner`. */
async function grantBadges(ctx: TestContext, userId: string, keys: string[]): Promise<void> {
  for (const key of keys) {
    await ctx.dataSource.query(
      'INSERT INTO user_badges (user_id, badge_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, key],
    );
  }
}

async function getAchievements(ctx: TestContext, userId: string): Promise<request.Test> {
  return request(ctx.app.getHttpServer()).get(`/users/${userId}/achievements`);
}

describe('GET /users/:user/achievements', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
  });

  it('shows a freshly seeded user as having unlocked nothing and only first purchase available', async () => {
    const response = await getAchievements(ctx, OTHER_USER_ID);

    expect(response.status).toBe(200);
    const body = response.body as AchievementsView;
    expect(body.unlocked_achievements).toEqual([]);
    expect(body.next_available_achievements).toEqual(['First Purchase']);
    expect(body.current_badge).toBe('Beginner');
    expect(body.next_badge).toBe('Intermediate');
    expect(body.remaining_to_unlock_next_badge).toBe(4);
  });

  it('offers only the next tier of the purchases group once first purchase is unlocked', async () => {
    await setPurchaseCount(ctx, DEMO_USER_ID, 1);
    await unlockAchievements(ctx, DEMO_USER_ID, ['first_purchase']);

    const response = await getAchievements(ctx, DEMO_USER_ID);

    const body = response.body as AchievementsView;
    // Exactly one entry: the single group's next tier, never the remaining ten.
    expect(body.next_available_achievements).toEqual(['3 Purchases']);
    expect(body.next_available_achievements).toHaveLength(1);
  });

  it('reports Intermediate as current badge once four achievements are unlocked', async () => {
    await setPurchaseCount(ctx, DEMO_USER_ID, 10);
    await unlockAchievements(ctx, DEMO_USER_ID, ACHIEVEMENT_KEYS_IN_TIER_ORDER.slice(0, 4));
    await grantBadges(ctx, DEMO_USER_ID, ['intermediate']);

    const response = await getAchievements(ctx, DEMO_USER_ID);

    const body = response.body as AchievementsView;
    expect(body.current_badge).toBe('Intermediate');
    expect(body.next_badge).toBe('Advanced');
    expect(body.remaining_to_unlock_next_badge).toBe(4);
  });

  it('reports four achievements remaining to Elite once Advanced is reached', async () => {
    await setPurchaseCount(ctx, DEMO_USER_ID, 50);
    await unlockAchievements(ctx, DEMO_USER_ID, ACHIEVEMENT_KEYS_IN_TIER_ORDER.slice(0, 8));
    await grantBadges(ctx, DEMO_USER_ID, ['intermediate', 'advanced']);

    const response = await getAchievements(ctx, DEMO_USER_ID);

    const body = response.body as AchievementsView;
    expect(body.current_badge).toBe('Advanced');
    expect(body.next_badge).toBe('Elite');
    expect(body.remaining_to_unlock_next_badge).toBe(4);
  });

  it('reports no next badge and nothing left to unlock once the whole ladder is complete', async () => {
    await setPurchaseCount(ctx, DEMO_USER_ID, 200);
    await unlockAchievements(ctx, DEMO_USER_ID, ACHIEVEMENT_KEYS_IN_TIER_ORDER);
    await grantBadges(ctx, DEMO_USER_ID, ['intermediate', 'advanced', 'elite']);

    const response = await getAchievements(ctx, DEMO_USER_ID);

    const body = response.body as AchievementsView;
    expect(body.next_badge).toBeNull();
    expect(body.remaining_to_unlock_next_badge).toBe(0);
    expect(body.next_available_achievements).toEqual([]);
    expect(body.unlocked_achievements).toHaveLength(ACHIEVEMENT_KEYS_IN_TIER_ORDER.length);
  });

  it('returns achievement names, not keys, ordered by tier regardless of unlock order', async () => {
    await setPurchaseCount(ctx, DEMO_USER_ID, 5);
    // Unlocked out of tier order: the response must not merely echo insertion order.
    await unlockAchievements(ctx, DEMO_USER_ID, [
      'three_purchases',
      'first_purchase',
      'five_purchases',
    ]);

    const response = await getAchievements(ctx, DEMO_USER_ID);

    const body = response.body as AchievementsView;
    expect(body.unlocked_achievements).toEqual(['First Purchase', '3 Purchases', '5 Purchases']);
  });

  it('returns 404 for a well-formed user id that does not exist', async () => {
    const response = await getAchievements(ctx, randomUUID());

    expect(response.status).toBe(404);
  });

  it('returns 400 for a user id that is not a uuid', async () => {
    const response = await getAchievements(ctx, 'not-a-uuid');

    expect(response.status).toBe(400);
  });

  it("never leaks one user's unlocked state into another user's view", async () => {
    await setPurchaseCount(ctx, DEMO_USER_ID, 10);
    await unlockAchievements(ctx, DEMO_USER_ID, ACHIEVEMENT_KEYS_IN_TIER_ORDER.slice(0, 4));
    await grantBadges(ctx, DEMO_USER_ID, ['intermediate']);

    const other = await getAchievements(ctx, OTHER_USER_ID);

    const body = other.body as AchievementsView;
    expect(body.unlocked_achievements).toEqual([]);
    expect(body.current_badge).toBe('Beginner');
    expect(body.next_available_achievements).toEqual(['First Purchase']);
  });
});
