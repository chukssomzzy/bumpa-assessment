import request from 'supertest';
import type { BddWorld } from '../support/application/bdd-world';

export interface AchievementsView {
  unlocked_achievements: string[];
  next_available_achievements: string[];
  current_badge: string;
  next_badge: string | null;
  remaining_to_unlock_next_badge: number;
}

export const ACHIEVEMENT_KEYS_IN_TIER_ORDER = [
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
export async function givenPurchaseCount(
  world: BddWorld,
  userId: string,
  count: number,
): Promise<void> {
  await world.dataSource.query('UPDATE user_progress SET purchase_count = $2 WHERE user_id = $1', [
    userId,
    count,
  ]);
}

/**
 * Unlocks achievements one statement at a time, in the order given, so
 * `unlocked_at` strictly increases and ordering assertions are meaningful.
 */
export async function givenUnlockedAchievements(
  world: BddWorld,
  userId: string,
  keys: string[],
): Promise<void> {
  for (const key of keys) {
    await world.dataSource.query(
      'INSERT INTO user_achievements (user_id, achievement_key) VALUES ($1, $2)',
      [userId, key],
    );
  }
}

/** Grants badges beyond the seeded `beginner`. */
export async function givenBadges(world: BddWorld, userId: string, keys: string[]): Promise<void> {
  for (const key of keys) {
    await world.dataSource.query(
      'INSERT INTO user_badges (user_id, badge_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, key],
    );
  }
}

export async function readAchievements(world: BddWorld, userId: string): Promise<request.Test> {
  return request(world.app.getHttpServer()).get(`/users/${userId}/achievements`);
}
