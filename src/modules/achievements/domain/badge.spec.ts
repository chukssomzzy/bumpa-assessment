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

describe('evaluateBadges', () => {
  it('never returns the zero-requirement badge, even when nothing else has been earned', () => {
    const state = makeState({
      unlockedAchievementKeys: [],
      earnedBadgeKeys: [],
    });

    expect(evaluateBadges(state, BADGES)).toEqual([]);
  });

  it('never returns the zero-requirement badge even when it is already recorded as earned', () => {
    const state = makeState({
      unlockedAchievementKeys: [],
      earnedBadgeKeys: ['beginner'],
    });

    expect(evaluateBadges(state, BADGES)).toEqual([]);
  });

  it('returns the badge newly crossed once its achievement requirement is met', () => {
    const state = makeState({
      unlockedAchievementKeys: unlockedKeys(4),
      earnedBadgeKeys: ['beginner'],
    });

    expect(evaluateBadges(state, BADGES)).toEqual([INTERMEDIATE]);
  });

  it('backfills every badge crossed at once, ordered by required count ascending', () => {
    const state = makeState({
      unlockedAchievementKeys: unlockedKeys(8),
      earnedBadgeKeys: ['beginner'],
    });

    expect(evaluateBadges(state, BADGES)).toEqual([INTERMEDIATE, ADVANCED]);
  });

  it('returns nothing once every badge has already been earned', () => {
    const state = makeState({
      unlockedAchievementKeys: unlockedKeys(12),
      earnedBadgeKeys: ['beginner', 'intermediate', 'advanced', 'elite'],
    });

    expect(evaluateBadges(state, BADGES)).toEqual([]);
  });

  it('does not mutate the user state or the definitions passed in', () => {
    const state = makeState({
      unlockedAchievementKeys: unlockedKeys(8),
      earnedBadgeKeys: ['beginner'],
    });
    const definitions: readonly BadgeDefinition[] = [BEGINNER, INTERMEDIATE, ADVANCED, ELITE];
    const stateSnapshot = JSON.parse(JSON.stringify(state));
    const definitionsSnapshot = JSON.parse(JSON.stringify(definitions));

    evaluateBadges(state, definitions);

    expect(state).toEqual(stateSnapshot);
    expect(definitions).toEqual(definitionsSnapshot);
  });
});

describe('badgeStatus', () => {
  it('matches the spec worked example: 5 unlocked, Beginner and Intermediate earned', () => {
    const state = makeState({
      unlockedAchievementKeys: unlockedKeys(5),
      earnedBadgeKeys: ['beginner', 'intermediate'],
    });

    expect(badgeStatus(state, BADGES)).toEqual({
      currentBadge: 'Intermediate',
      nextBadge: 'Advanced',
      remainingToUnlockNextBadge: 3,
    });
  });

  it('gives a brand new user Beginner as current and Intermediate as next', () => {
    const state = makeState({
      unlockedAchievementKeys: [],
      earnedBadgeKeys: ['beginner'],
    });

    expect(badgeStatus(state, BADGES)).toEqual({
      currentBadge: 'Beginner',
      nextBadge: 'Intermediate',
      remainingToUnlockNextBadge: 4,
    });
  });

  it('reports Elite with no next badge and zero remaining at the top of the ladder', () => {
    const state = makeState({
      unlockedAchievementKeys: unlockedKeys(12),
      earnedBadgeKeys: ['beginner', 'intermediate', 'advanced', 'elite'],
    });

    expect(badgeStatus(state, BADGES)).toEqual({
      currentBadge: 'Elite',
      nextBadge: null,
      remainingToUnlockNextBadge: 0,
    });
  });

  it('floors remaining at zero rather than going negative when the count already exceeds the next requirement', () => {
    const state = makeState({
      unlockedAchievementKeys: unlockedKeys(10),
      earnedBadgeKeys: ['beginner', 'intermediate'],
    });

    expect(badgeStatus(state, BADGES)).toEqual({
      currentBadge: 'Intermediate',
      nextBadge: 'Advanced',
      remainingToUnlockNextBadge: 0,
    });
  });

  it('never returns null for currentBadge', () => {
    const state = makeState({
      unlockedAchievementKeys: [],
      earnedBadgeKeys: ['beginner'],
    });

    expect(badgeStatus(state, BADGES).currentBadge).not.toBeNull();
  });
});
