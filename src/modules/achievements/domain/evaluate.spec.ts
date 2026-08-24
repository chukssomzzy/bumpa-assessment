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

describe('Feature: achievements unlock as a purchase count crosses thresholds', () => {
  describe('Scenario: the user has made no purchases', () => {
    it('returns nothing', () => {
      // Given
      const state = makeState({ progress: { purchaseCount: 0 } });

      // When
      const unlocked = evaluateAchievements(state, ACHIEVEMENTS);

      // Then
      expect(unlocked).toEqual([]);
    });
  });

  describe('Scenario: the first threshold is met with nothing unlocked yet', () => {
    it('returns the first tier', () => {
      // Given
      const state = makeState({ progress: { purchaseCount: 1 } });

      // When
      const unlocked = evaluateAchievements(state, ACHIEVEMENTS);

      // Then
      expect(unlocked).toEqual([FIRST_PURCHASE]);
    });
  });

  describe('Scenario: a lower tier of the group is already unlocked', () => {
    it('returns only the newly crossed tier', () => {
      // Given
      const state = makeState({
        progress: { purchaseCount: 5 },
        unlockedAchievementKeys: ['first_purchase'],
      });

      // When
      const unlocked = evaluateAchievements(state, ACHIEVEMENTS);

      // Then
      expect(unlocked).toEqual([FIVE_PURCHASES]);
    });
  });

  describe('Scenario: the purchase count jumps past several thresholds at once', () => {
    it('backfills every tier crossed, ordered by tier ascending', () => {
      // Given
      const state = makeState({ progress: { purchaseCount: 10 } });

      // When
      const unlocked = evaluateAchievements(state, ACHIEVEMENTS);

      // Then
      expect(unlocked).toEqual([FIRST_PURCHASE, FIVE_PURCHASES, TEN_PURCHASES]);
    });
  });

  describe('Scenario: every achievement is already unlocked', () => {
    it('returns nothing', () => {
      // Given
      const state = makeState({
        progress: { purchaseCount: 10 },
        unlockedAchievementKeys: ['first_purchase', 'five_purchases', 'ten_purchases'],
      });

      // When
      const unlocked = evaluateAchievements(state, ACHIEVEMENTS);

      // Then
      expect(unlocked).toEqual([]);
    });
  });

  describe('Scenario: there are no definitions to evaluate', () => {
    it('returns nothing', () => {
      // Given
      const state = makeState({ progress: { purchaseCount: 100 } });

      // When
      const unlocked = evaluateAchievements(state, []);

      // Then
      expect(unlocked).toEqual([]);
    });
  });

  describe('Scenario: definitions from several groups arrive out of order', () => {
    it('orders newly crossed achievements by group key then tier', () => {
      // Given
      const definitions: readonly AchievementDefinition[] = [
        BIG_SPEND,
        TEN_PURCHASES,
        FIRST_SPEND,
        FIRST_PURCHASE,
        FIVE_PURCHASES,
      ];
      const state = makeState({ progress: { purchaseCount: 10 } });

      // When
      const unlocked = evaluateAchievements(state, definitions);

      // Then
      expect(unlocked).toEqual([
        FIRST_PURCHASE,
        FIVE_PURCHASES,
        TEN_PURCHASES,
        FIRST_SPEND,
        BIG_SPEND,
      ]);
    });
  });

  describe('Scenario: the caller reuses the state and definitions afterwards', () => {
    it('does not mutate the user state or the definitions passed in', () => {
      // Given
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

      // When
      evaluateAchievements(state, definitions);

      // Then
      expect(state).toEqual(stateSnapshot);
      expect(definitions).toEqual(definitionsSnapshot);
    });
  });
});
