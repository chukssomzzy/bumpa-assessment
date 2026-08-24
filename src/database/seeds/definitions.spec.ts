import { ACHIEVEMENT_DEFINITIONS, BADGE_DEFINITIONS } from './definitions';

/**
 * Guards the seed against internal inconsistency. These are cheap invariants,
 * but one of them (reachability) protects the entire cashback feature: a badge
 * ladder that outruns the achievement ladder silently makes every payout
 * impossible without failing anything.
 */
describe('Feature: the seeded achievement and badge ladders stay consistent', () => {
  describe('Scenario: the badge ladder is compared against the achievement ladder', () => {
    it('keeps every badge reachable by the achievements that exist', () => {
      // Given
      const definitions = BADGE_DEFINITIONS;

      // When
      const highestRequirement = Math.max(...definitions.map((b) => b.requiredAchievementCount));

      // Then
      expect(highestRequirement).toBeLessThanOrEqual(ACHIEVEMENT_DEFINITIONS.length);
    });
  });

  describe('Scenario: a user has earned nothing yet', () => {
    it('defines exactly one zero-requirement badge as initial state', () => {
      // Given
      const definitions = BADGE_DEFINITIONS;

      // When
      const initial = definitions.filter((b) => b.requiredAchievementCount === 0);

      // Then
      expect(initial).toHaveLength(1);
    });
  });

  describe('Scenario: achievements are identified by key', () => {
    it('gives every achievement a unique key', () => {
      // Given
      const definitions = ACHIEVEMENT_DEFINITIONS;

      // When
      const keys = definitions.map((a) => a.key);

      // Then
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  describe('Scenario: badges are identified by key and ordered by requirement', () => {
    it('gives every badge a unique key and a unique requirement', () => {
      // Given
      const definitions = BADGE_DEFINITIONS;

      // When
      const keys = definitions.map((b) => b.key);
      const requirements = definitions.map((b) => b.requiredAchievementCount);

      // Then
      expect(new Set(keys).size).toBe(keys.length);
      expect(new Set(requirements).size).toBe(requirements.length);
    });
  });

  describe('Scenario: achievements within a group are laid out as tiers', () => {
    it('numbers tiers contiguously from one within each group', () => {
      // Given
      const groups = new Set(ACHIEVEMENT_DEFINITIONS.map((a) => a.groupKey));

      // When
      const tiersByGroup = [...groups].map((group) =>
        ACHIEVEMENT_DEFINITIONS.filter((a) => a.groupKey === group)
          .map((a) => a.tier)
          .sort((a, b) => a - b),
      );

      // Then
      for (const tiers of tiersByGroup) {
        expect(tiers).toEqual(tiers.map((_, index) => index + 1));
      }
    });
  });

  describe('Scenario: the thresholds of one group are read in tier order', () => {
    it('raises the threshold with every tier so a higher tier is never easier', () => {
      // Given
      const groups = new Set(ACHIEVEMENT_DEFINITIONS.map((a) => a.groupKey));

      // When
      const orderedByGroup = [...groups].map((group) =>
        ACHIEVEMENT_DEFINITIONS.filter((a) => a.groupKey === group).sort((a, b) => a.tier - b.tier),
      );

      // Then
      for (const ordered of orderedByGroup) {
        for (let i = 1; i < ordered.length; i++) {
          expect(ordered[i].threshold).toBeGreaterThan(ordered[i - 1].threshold);
        }
      }
    });
  });
});
