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

describe('Feature: the next achievement to chase is offered one tier at a time', () => {
  describe('Scenario: nothing in the group is unlocked', () => {
    it('offers only the lowest tier of the group, never every tier at once', () => {
      // Given
      const state = makeState({ unlockedAchievementKeys: [] });

      // When
      const result = nextAvailableAchievements(state, ACHIEVEMENTS);

      // Then
      expect(result).toEqual([FIRST_PURCHASE]);
      expect(result).not.toContainEqual(FIVE_PURCHASES);
      expect(result).not.toContainEqual(TEN_PURCHASES);
    });
  });

  describe('Scenario: a brand new user has zero purchases and nothing unlocked', () => {
    it('offers the first tier as the next target', () => {
      // Given
      const state = makeState({
        progress: { purchaseCount: 0 },
        unlockedAchievementKeys: [],
      });

      // When
      const result = nextAvailableAchievements(state, ACHIEVEMENTS);

      // Then
      expect(result).toEqual([FIRST_PURCHASE]);
    });
  });

  describe('Scenario: the first tier is unlocked but no further purchases were made', () => {
    it('advances to the second tier regardless of purchase count', () => {
      // Given
      const state = makeState({
        progress: { purchaseCount: 0 },
        unlockedAchievementKeys: ['first_purchase'],
      });

      // When
      const result = nextAvailableAchievements(state, ACHIEVEMENTS);

      // Then
      expect(result).toEqual([FIVE_PURCHASES]);
    });
  });

  describe('Scenario: the first two tiers of the group are unlocked', () => {
    it('advances to the third tier', () => {
      // Given
      const state = makeState({
        unlockedAchievementKeys: ['first_purchase', 'five_purchases'],
      });

      // When
      const result = nextAvailableAchievements(state, ACHIEVEMENTS);

      // Then
      expect(result).toEqual([TEN_PURCHASES]);
    });
  });

  describe('Scenario: every tier in the group is unlocked', () => {
    it('omits the group entirely', () => {
      // Given
      const state = makeState({
        unlockedAchievementKeys: ['first_purchase', 'five_purchases', 'ten_purchases'],
      });

      // When
      const result = nextAvailableAchievements(state, ACHIEVEMENTS);

      // Then
      expect(result).toEqual([]);
    });
  });

  describe('Scenario: several groups still have an un-earned tier', () => {
    it('returns exactly one entry per group, ordered by group key', () => {
      // Given
      const definitions: readonly AchievementDefinition[] = [
        BIG_SPEND,
        TEN_PURCHASES,
        FIRST_SPEND,
        FIRST_PURCHASE,
        FIVE_PURCHASES,
      ];
      const state = makeState({ unlockedAchievementKeys: ['first_purchase'] });

      // When
      const result = nextAvailableAchievements(state, definitions);

      // Then
      expect(result).toEqual([FIVE_PURCHASES, FIRST_SPEND]);
    });
  });

  describe('Scenario: the caller reuses the state and definitions afterwards', () => {
    it('does not mutate the user state or the definitions passed in', () => {
      // Given
      const state = makeState({ unlockedAchievementKeys: ['first_purchase'] });
      const definitions: readonly AchievementDefinition[] = [
        FIRST_PURCHASE,
        FIVE_PURCHASES,
        TEN_PURCHASES,
      ];
      const stateSnapshot = JSON.parse(JSON.stringify(state));
      const definitionsSnapshot = JSON.parse(JSON.stringify(definitions));

      // When
      nextAvailableAchievements(state, definitions);

      // Then
      expect(state).toEqual(stateSnapshot);
      expect(definitions).toEqual(definitionsSnapshot);
    });
  });
});
