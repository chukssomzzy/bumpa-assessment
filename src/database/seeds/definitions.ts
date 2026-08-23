import type { AchievementDefinition, BadgeDefinition } from '../../achievements/domain/types';

/**
 * Reference data the system reads at runtime — not test fixtures.
 *
 * Adding a tier or a badge level is an edit here plus a re-seed: no code change,
 * which is the extensibility the brief asks for.
 */
export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  {
    key: 'first_purchase',
    name: 'First Purchase',
    groupKey: 'purchases',
    metric: 'purchase_count',
    threshold: 1,
    tier: 1,
  },
  {
    key: 'five_purchases',
    name: '5 Purchases',
    groupKey: 'purchases',
    metric: 'purchase_count',
    threshold: 5,
    tier: 2,
  },
  {
    key: 'ten_purchases',
    name: '10 Purchases',
    groupKey: 'purchases',
    metric: 'purchase_count',
    threshold: 10,
    tier: 3,
  },
];

/** A zero requirement marks initial state: granted on creation, never paid. */
export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  { key: 'beginner', name: 'Beginner', requiredAchievementCount: 0 },
  { key: 'intermediate', name: 'Intermediate', requiredAchievementCount: 4 },
  { key: 'advanced', name: 'Advanced', requiredAchievementCount: 8 },
  { key: 'elite', name: 'Elite', requiredAchievementCount: 12 },
];

/**
 * Demo customers, so the documented flow is executable on a clean checkout.
 * Test bank details — Paystack test mode accepts any well-formed Nigerian account.
 */
export const DEMO_USERS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Ada Demo',
    email: 'ada@example.com',
    bankCode: '058',
    accountNumber: '0000000001',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Bola Demo',
    email: 'bola@example.com',
    bankCode: '058',
    accountNumber: '0000000002',
  },
];
