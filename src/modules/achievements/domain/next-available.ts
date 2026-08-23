import type { AchievementDefinition, UserState } from './types';

/**
 * The next achievement the user can unlock, for each group.
 *
 * Exactly one entry per group that still has an un-earned tier: the lowest such
 * tier. Groups the user has exhausted are omitted. Ordered by group key.
 */
export function nextAvailableAchievements(
  state: UserState,
  definitions: readonly AchievementDefinition[],
): AchievementDefinition[] {
  const unlockedKeys = new Set(state.unlockedAchievementKeys);
  const groupKeys = new Set(definitions.map((definition) => definition.groupKey));

  const nextByGroup = [...groupKeys].map((groupKey) => {
    const lowestUnearnedTier = definitions
      .filter((definition) => definition.groupKey === groupKey && !unlockedKeys.has(definition.key))
      .sort((a, b) => a.tier - b.tier)[0];

    return lowestUnearnedTier;
  });

  return nextByGroup
    .filter((definition): definition is AchievementDefinition => definition !== undefined)
    .sort((a, b) => a.groupKey.localeCompare(b.groupKey));
}
