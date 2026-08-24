import type { BadgeDefinition, UserState } from './types';
import { badgeStatus, evaluateBadges } from './badge';

const BEGINNER: BadgeDefinition = {
  key: 'beginner',
  name: 'Beginner',
  requiredAchievementCount: 0,
};

const INTERMEDIATE: BadgeDefinition = {
  key: 'intermediate',
  name: 'Intermediate',
  requiredAchievementCount: 4,
};

const ADVANCED: BadgeDefinition = {
  key: 'advanced',
  name: 'Advanced',
  requiredAchievementCount: 8,
};

const ELITE: BadgeDefinition = {
  key: 'elite',
  name: 'Elite',
  requiredAchievementCount: 12,
};

const BADGES: readonly BadgeDefinition[] = [BEGINNER, INTERMEDIATE, ADVANCED, ELITE];

function unlockedKeys(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `achievement_${i + 1}`);
}

function makeState(overrides: Partial<UserState> = {}): UserState {
  return {
    progress: { purchaseCount: 0 },
    unlockedAchievementKeys: [],
    earnedBadgeKeys: [],
    ...overrides,
  };
}

describe('Feature: badges are awarded as unlocked achievements accumulate', () => {
  describe('Scenario: a user has unlocked nothing at all', () => {
    it('never returns the zero-requirement badge', () => {
      // Given
      const state = makeState({
        unlockedAchievementKeys: [],
        earnedBadgeKeys: [],
      });

      // When
      const awarded = evaluateBadges(state, BADGES);

      // Then
      expect(awarded).toEqual([]);
    });
  });

  describe('Scenario: the zero-requirement badge is already recorded as earned', () => {
    it('never returns it a second time', () => {
      // Given
      const state = makeState({
        unlockedAchievementKeys: [],
        earnedBadgeKeys: ['beginner'],
      });

      // When
      const awarded = evaluateBadges(state, BADGES);

      // Then
      expect(awarded).toEqual([]);
    });
  });

  describe('Scenario: the achievement count reaches the next badge requirement', () => {
    it('returns the badge newly crossed', () => {
      // Given
      const state = makeState({
        unlockedAchievementKeys: unlockedKeys(4),
        earnedBadgeKeys: ['beginner'],
      });

      // When
      const awarded = evaluateBadges(state, BADGES);

      // Then
      expect(awarded).toEqual([INTERMEDIATE]);
    });
  });

  describe('Scenario: the achievement count jumps past several badge requirements', () => {
    it('backfills every badge crossed at once, ordered by required count ascending', () => {
      // Given
      const state = makeState({
        unlockedAchievementKeys: unlockedKeys(8),
        earnedBadgeKeys: ['beginner'],
      });

      // When
      const awarded = evaluateBadges(state, BADGES);

      // Then
      expect(awarded).toEqual([INTERMEDIATE, ADVANCED]);
    });
  });

  describe('Scenario: every badge on the ladder has already been earned', () => {
    it('returns nothing', () => {
      // Given
      const state = makeState({
        unlockedAchievementKeys: unlockedKeys(12),
        earnedBadgeKeys: ['beginner', 'intermediate', 'advanced', 'elite'],
      });

      // When
      const awarded = evaluateBadges(state, BADGES);

      // Then
      expect(awarded).toEqual([]);
    });
  });

  describe('Scenario: the caller reuses the state and definitions afterwards', () => {
    it('does not mutate the user state or the definitions passed in', () => {
      // Given
      const state = makeState({
        unlockedAchievementKeys: unlockedKeys(8),
        earnedBadgeKeys: ['beginner'],
      });
      const definitions: readonly BadgeDefinition[] = [BEGINNER, INTERMEDIATE, ADVANCED, ELITE];
      const stateSnapshot = JSON.parse(JSON.stringify(state));
      const definitionsSnapshot = JSON.parse(JSON.stringify(definitions));

      // When
      evaluateBadges(state, definitions);

      // Then
      expect(state).toEqual(stateSnapshot);
      expect(definitions).toEqual(definitionsSnapshot);
    });
  });
});

describe('Feature: badge status reports where a user stands on the ladder', () => {
  describe('Scenario: the worked example from the spec, 5 unlocked achievements', () => {
    it('reports Intermediate as current, Advanced as next and 3 remaining', () => {
      // Given
      const state = makeState({
        unlockedAchievementKeys: unlockedKeys(5),
        earnedBadgeKeys: ['beginner', 'intermediate'],
      });

      // When
      const status = badgeStatus(state, BADGES);

      // Then
      expect(status).toEqual({
        currentBadge: 'Intermediate',
        nextBadge: 'Advanced',
        remainingToUnlockNextBadge: 3,
      });
    });
  });

  describe('Scenario: a brand new user has unlocked nothing', () => {
    it('reports Beginner as current and Intermediate as next', () => {
      // Given
      const state = makeState({
        unlockedAchievementKeys: [],
        earnedBadgeKeys: ['beginner'],
      });

      // When
      const status = badgeStatus(state, BADGES);

      // Then
      expect(status).toEqual({
        currentBadge: 'Beginner',
        nextBadge: 'Intermediate',
        remainingToUnlockNextBadge: 4,
      });
    });
  });

  describe('Scenario: a user sits at the top of the ladder', () => {
    it('reports Elite with no next badge and zero remaining', () => {
      // Given
      const state = makeState({
        unlockedAchievementKeys: unlockedKeys(12),
        earnedBadgeKeys: ['beginner', 'intermediate', 'advanced', 'elite'],
      });

      // When
      const status = badgeStatus(state, BADGES);

      // Then
      expect(status).toEqual({
        currentBadge: 'Elite',
        nextBadge: null,
        remainingToUnlockNextBadge: 0,
      });
    });
  });

  describe('Scenario: the achievement count already exceeds the next requirement', () => {
    it('floors remaining at zero rather than going negative', () => {
      // Given
      const state = makeState({
        unlockedAchievementKeys: unlockedKeys(10),
        earnedBadgeKeys: ['beginner', 'intermediate'],
      });

      // When
      const status = badgeStatus(state, BADGES);

      // Then
      expect(status).toEqual({
        currentBadge: 'Intermediate',
        nextBadge: 'Advanced',
        remainingToUnlockNextBadge: 0,
      });
    });
  });

  describe('Scenario: a user has earned only the initial badge', () => {
    it('never returns null for currentBadge', () => {
      // Given
      const state = makeState({
        unlockedAchievementKeys: [],
        earnedBadgeKeys: ['beginner'],
      });

      // When
      const status = badgeStatus(state, BADGES);

      // Then
      expect(status.currentBadge).not.toBeNull();
    });
  });
});
