import { ACHIEVEMENT_DEFINITIONS, BADGE_DEFINITIONS } from './definitions';

/**
 * Guards the seed against internal inconsistency. These are cheap invariants,
 * but one of them (reachability) protects the entire cashback feature: a badge
 * ladder that outruns the achievement ladder silently makes every payout
 * impossible without failing anything.
 */
describe('seeded definitions', () => {
  it('keeps every badge reachable by the achievements that exist', () => {
    const highestRequirement = Math.max(
      ...BADGE_DEFINITIONS.map((b) => b.requiredAchievementCount),
    );

    expect(highestRequirement).toBeLessThanOrEqual(ACHIEVEMENT_DEFINITIONS.length);
  });

  it('defines exactly one zero-requirement badge as initial state', () => {
    const initial = BADGE_DEFINITIONS.filter((b) => b.requiredAchievementCount === 0);

    expect(initial).toHaveLength(1);
  });

  it('gives every achievement a unique key', () => {
    const keys = ACHIEVEMENT_DEFINITIONS.map((a) => a.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every badge a unique key and a unique requirement', () => {
    const keys = BADGE_DEFINITIONS.map((b) => b.key);
    const requirements = BADGE_DEFINITIONS.map((b) => b.requiredAchievementCount);

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(requirements).size).toBe(requirements.length);
  });

  it('numbers tiers contiguously from one within each group', () => {
    const groups = new Set(ACHIEVEMENT_DEFINITIONS.map((a) => a.groupKey));

    for (const group of groups) {
      const tiers = ACHIEVEMENT_DEFINITIONS.filter((a) => a.groupKey === group)
        .map((a) => a.tier)
        .sort((a, b) => a - b);

      expect(tiers).toEqual(tiers.map((_, index) => index + 1));
    }
  });

  it('raises the threshold with every tier so a higher tier is never easier', () => {
    const groups = new Set(ACHIEVEMENT_DEFINITIONS.map((a) => a.groupKey));

    for (const group of groups) {
      const ordered = ACHIEVEMENT_DEFINITIONS.filter((a) => a.groupKey === group).sort(
        (a, b) => a.tier - b.tier,
      );

      for (let i = 1; i < ordered.length; i++) {
        expect(ordered[i].threshold).toBeGreaterThan(ordered[i - 1].threshold);
      }
    }
  });
});
