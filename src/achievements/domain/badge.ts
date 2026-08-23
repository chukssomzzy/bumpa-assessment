import type { BadgeDefinition, BadgeStatus, UserState } from './types';

/**
 * Badges newly crossed by the user's unlocked-achievement count.
 *
 * Excludes badges already earned and any badge with a zero requirement, which is
 * initial state and must never trigger a payout. Ordered ascending by requirement.
 */
export function evaluateBadges(
  state: UserState,
  definitions: readonly BadgeDefinition[],
): BadgeDefinition[] {
  const earnedKeys = new Set(state.earnedBadgeKeys);
  const unlockedCount = state.unlockedAchievementKeys.length;

  return definitions
    .filter(
      (definition) =>
        definition.requiredAchievementCount > 0 &&
        !earnedKeys.has(definition.key) &&
        unlockedCount >= definition.requiredAchievementCount,
    )
    .sort((a, b) => a.requiredAchievementCount - b.requiredAchievementCount);
}

/**
 * The badge portion of the achievements endpoint response.
 *
 * `currentBadge` is the highest earned badge and is never null, because the
 * zero-requirement badge is granted at user creation. `nextBadge` is null and
 * `remainingToUnlockNextBadge` is 0 once the top of the ladder is reached.
 */
export function badgeStatus(
  state: UserState,
  definitions: readonly BadgeDefinition[],
): BadgeStatus {
  const earnedKeys = new Set(state.earnedBadgeKeys);
  const ladder = [...definitions].sort(
    (a, b) => a.requiredAchievementCount - b.requiredAchievementCount,
  );

  const earnedLadder = ladder.filter((definition) => earnedKeys.has(definition.key));
  const currentIndex =
    earnedLadder.length > 0 ? ladder.indexOf(earnedLadder[earnedLadder.length - 1]) : 0;
  const currentBadge = ladder[currentIndex];
  const nextBadge = ladder[currentIndex + 1] ?? null;

  return {
    currentBadge: currentBadge.name,
    nextBadge: nextBadge?.name ?? null,
    remainingToUnlockNextBadge: nextBadge
      ? Math.max(0, nextBadge.requiredAchievementCount - state.unlockedAchievementKeys.length)
      : 0,
  };
}
