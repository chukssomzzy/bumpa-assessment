import type {
  AchievementDefinition,
  BadgeDefinition,
} from '../../modules/achievements/domain/types';

/**
 * Reference data the system reads at runtime — not test fixtures.
 *
 * Adding a tier or a badge level is an edit here plus a re-seed: no code change,
 * which is the extensibility the brief asks for.
 *
 * The ladder runs to twelve tiers because the badge ladder tops out at twelve
 * achievements: a shorter ladder would make Elite — and every cashback above
 * Beginner — permanently unreachable. Tier count and the top badge requirement
 * must stay in step, which `definitions.spec.ts` asserts.
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
    key: 'three_purchases',
    name: '3 Purchases',
    groupKey: 'purchases',
    metric: 'purchase_count',
    threshold: 3,
    tier: 2,
  },
  {
    key: 'five_purchases',
    name: '5 Purchases',
    groupKey: 'purchases',
    metric: 'purchase_count',
    threshold: 5,
    tier: 3,
  },
  {
    key: 'ten_purchases',
    name: '10 Purchases',
    groupKey: 'purchases',
    metric: 'purchase_count',
    threshold: 10,
    tier: 4,
  },
  {
    key: 'fifteen_purchases',
    name: '15 Purchases',
    groupKey: 'purchases',
    metric: 'purchase_count',
    threshold: 15,
    tier: 5,
  },
  {
    key: 'twenty_purchases',
    name: '20 Purchases',
    groupKey: 'purchases',
    metric: 'purchase_count',
    threshold: 20,
    tier: 6,
  },
  {
    key: 'twentyfive_purchases',
    name: '25 Purchases',
    groupKey: 'purchases',
    metric: 'purchase_count',
    threshold: 25,
    tier: 7,
  },
  {
    key: 'fifty_purchases',
    name: '50 Purchases',
    groupKey: 'purchases',
    metric: 'purchase_count',
    threshold: 50,
    tier: 8,
  },
  {
    key: 'seventyfive_purchases',
    name: '75 Purchases',
    groupKey: 'purchases',
    metric: 'purchase_count',
    threshold: 75,
    tier: 9,
  },
  {
    key: 'hundred_purchases',
    name: '100 Purchases',
    groupKey: 'purchases',
    metric: 'purchase_count',
    threshold: 100,
    tier: 10,
  },
  {
    key: 'onefifty_purchases',
    name: '150 Purchases',
    groupKey: 'purchases',
    metric: 'purchase_count',
    threshold: 150,
    tier: 11,
  },
  {
    key: 'twohundred_purchases',
    name: '200 Purchases',
    groupKey: 'purchases',
    metric: 'purchase_count',
    threshold: 200,
    tier: 12,
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
