import type { AchievementDefinition, UserState } from './types';
import { evaluateAchievements } from './evaluate';

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

describe('evaluateAchievements', () => {
  it('returns nothing when purchase count is zero', () => {
    const state = makeState({ progress: { purchaseCount: 0 } });

    expect(evaluateAchievements(state, ACHIEVEMENTS)).toEqual([]);
  });

  it('returns the first tier once the threshold is met with nothing unlocked', () => {
    const state = makeState({ progress: { purchaseCount: 1 } });

    expect(evaluateAchievements(state, ACHIEVEMENTS)).toEqual([FIRST_PURCHASE]);
  });

  it('returns only the newly crossed tier when a lower tier is already unlocked', () => {
    const state = makeState({
      progress: { purchaseCount: 5 },
      unlockedAchievementKeys: ['first_purchase'],
    });

    expect(evaluateAchievements(state, ACHIEVEMENTS)).toEqual([FIVE_PURCHASES]);
  });

  it('backfills every tier crossed at once, ordered by tier ascending', () => {
    const state = makeState({ progress: { purchaseCount: 10 } });

    expect(evaluateAchievements(state, ACHIEVEMENTS)).toEqual([
      FIRST_PURCHASE,
      FIVE_PURCHASES,
      TEN_PURCHASES,
    ]);
  });

  it('returns nothing when every achievement is already unlocked', () => {
    const state = makeState({
      progress: { purchaseCount: 10 },
      unlockedAchievementKeys: ['first_purchase', 'five_purchases', 'ten_purchases'],
    });

    expect(evaluateAchievements(state, ACHIEVEMENTS)).toEqual([]);
  });

  it('returns nothing when there are no definitions to evaluate', () => {
    const state = makeState({ progress: { purchaseCount: 100 } });

    expect(evaluateAchievements(state, [])).toEqual([]);
  });

  it('orders newly crossed achievements by group key then tier across multiple groups', () => {
    const definitions: readonly AchievementDefinition[] = [
      BIG_SPEND,
      TEN_PURCHASES,
      FIRST_SPEND,
      FIRST_PURCHASE,
      FIVE_PURCHASES,
    ];
    const state = makeState({ progress: { purchaseCount: 10 } });

    expect(evaluateAchievements(state, definitions)).toEqual([
      FIRST_PURCHASE,
      FIVE_PURCHASES,
      TEN_PURCHASES,
      FIRST_SPEND,
      BIG_SPEND,
    ]);
  });

  it('does not mutate the user state or the definitions passed in', () => {
    const state = makeState({
      progress: { purchaseCount: 5 },
      unlockedAchievementKeys: ['first_purchase'],
    });
    const definitions: readonly AchievementDefinition[] = [
      FIRST_PURCHASE,
      FIVE_PURCHASES,
      TEN_PURCHASES,
    ];
    const stateSnapshot = JSON.parse(JSON.stringify(state));
    const definitionsSnapshot = JSON.parse(JSON.stringify(definitions));

    evaluateAchievements(state, definitions);

    expect(state).toEqual(stateSnapshot);
    expect(definitions).toEqual(definitionsSnapshot);
  });
});
