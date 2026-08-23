import type { AchievementDefinition, UserState } from './types';
import { nextAvailableAchievements } from './next-available';

const FIRST_PURCHASE: AchievementDefinition = {
  key: 'first_purchase',
  name: 'First Purchase',
  groupKey: 'purchases',
  metric: 'purchase_count',
  threshold: 1,
  tier: 1,
};

const FIVE_PURCHASES: AchievementDefinition = {
  key: 'five_purchases',
  name: '5 Purchases',
  groupKey: 'purchases',
  metric: 'purchase_count',
  threshold: 5,
  tier: 2,
};

const TEN_PURCHASES: AchievementDefinition = {
  key: 'ten_purchases',
  name: '10 Purchases',
  groupKey: 'purchases',
  metric: 'purchase_count',
  threshold: 10,
  tier: 3,
};

const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  FIRST_PURCHASE,
  FIVE_PURCHASES,
  TEN_PURCHASES,
];

// A second, independent ladder used to exercise cross-group ordering.
const FIRST_SPEND: AchievementDefinition = {
  key: 'first_spend',
  name: 'First Spend',
  groupKey: 'spend',
  metric: 'purchase_count',
  threshold: 1,
  tier: 1,
};

const BIG_SPEND: AchievementDefinition = {
  key: 'big_spend',
  name: 'Big Spend',
  groupKey: 'spend',
  metric: 'purchase_count',
  threshold: 10,
  tier: 2,
};

function makeState(overrides: Partial<UserState> = {}): UserState {
  return {
    progress: { purchaseCount: 0 },
    unlockedAchievementKeys: [],
    earnedBadgeKeys: [],
    ...overrides,
  };
}

describe('nextAvailableAchievements', () => {
  it('offers only the lowest tier of a group, never every tier at once, when nothing is unlocked', () => {
    const state = makeState({ unlockedAchievementKeys: [] });

    const result = nextAvailableAchievements(state, ACHIEVEMENTS);

    expect(result).toEqual([FIRST_PURCHASE]);
    expect(result).not.toContainEqual(FIVE_PURCHASES);
    expect(result).not.toContainEqual(TEN_PURCHASES);
  });

  it('offers the first tier as the next target even with zero purchases and nothing unlocked', () => {
    const state = makeState({
      progress: { purchaseCount: 0 },
      unlockedAchievementKeys: [],
    });

    expect(nextAvailableAchievements(state, ACHIEVEMENTS)).toEqual([FIRST_PURCHASE]);
  });

  it('advances to the second tier once the first tier is unlocked, regardless of purchase count', () => {
    const state = makeState({
      progress: { purchaseCount: 0 },
      unlockedAchievementKeys: ['first_purchase'],
    });

    expect(nextAvailableAchievements(state, ACHIEVEMENTS)).toEqual([FIVE_PURCHASES]);
  });

  it('advances to the third tier once the first two tiers are unlocked', () => {
    const state = makeState({
      unlockedAchievementKeys: ['first_purchase', 'five_purchases'],
    });

    expect(nextAvailableAchievements(state, ACHIEVEMENTS)).toEqual([TEN_PURCHASES]);
  });

  it('omits a group entirely once every tier in it is unlocked', () => {
    const state = makeState({
      unlockedAchievementKeys: ['first_purchase', 'five_purchases', 'ten_purchases'],
    });

    expect(nextAvailableAchievements(state, ACHIEVEMENTS)).toEqual([]);
  });

  it('returns exactly one entry per group with an un-earned tier, ordered by group key', () => {
    const definitions: readonly AchievementDefinition[] = [
      BIG_SPEND,
      TEN_PURCHASES,
      FIRST_SPEND,
      FIRST_PURCHASE,
      FIVE_PURCHASES,
    ];
    const state = makeState({ unlockedAchievementKeys: ['first_purchase'] });

    expect(nextAvailableAchievements(state, definitions)).toEqual([FIVE_PURCHASES, FIRST_SPEND]);
  });

  it('does not mutate the user state or the definitions passed in', () => {
    const state = makeState({ unlockedAchievementKeys: ['first_purchase'] });
    const definitions: readonly AchievementDefinition[] = [
      FIRST_PURCHASE,
      FIVE_PURCHASES,
      TEN_PURCHASES,
    ];
    const stateSnapshot = JSON.parse(JSON.stringify(state));
    const definitionsSnapshot = JSON.parse(JSON.stringify(definitions));

    nextAvailableAchievements(state, definitions);

    expect(state).toEqual(stateSnapshot);
    expect(definitions).toEqual(definitionsSnapshot);
  });
});
