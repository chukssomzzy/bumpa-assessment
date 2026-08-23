import type { AchievementDefinition, UserState } from './types';

/**
 * Achievements newly unlocked by the user's current state.
 *
 * Returns only achievements whose threshold is met and which are not already
 * unlocked, ordered by group then tier. Pure: the caller persists the result.
 */
export function evaluateAchievements(
  state: UserState,
  definitions: readonly AchievementDefinition[],
): AchievementDefinition[] {
  const unlockedKeys = new Set(state.unlockedAchievementKeys);

  return definitions
    .filter(
      (definition) =>
        !unlockedKeys.has(definition.key) && state.progress.purchaseCount >= definition.threshold,
    )
    .sort((a, b) => a.groupKey.localeCompare(b.groupKey) || a.tier - b.tier);
}
