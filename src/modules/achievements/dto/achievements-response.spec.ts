import { achievementsResponseSchema, AchievementsResponse } from './achievements-response.dto';

/**
 * The documented class and the runtime schema describe the same contract but
 * are enforced by different mechanisms, so nothing stops them drifting. A drift
 * here is not cosmetic: the interceptor projects onto the SCHEMA's keys, so a
 * field documented but missing from the schema would be silently stripped from
 * every response while the docs kept promising it.
 */
describe('Feature: the documented response contract matches the schema that enforces it', () => {
  describe('Scenario: the class and the schema are compared', () => {
    it('declares exactly the same keys in both', () => {
      // Given
      const documented: AchievementsResponse = {
        unlocked_achievements: [],
        next_available_achievements: [],
        current_badge: 'Beginner',
        next_badge: null,
        remaining_to_unlock_next_badge: 0,
      };

      // When
      const schemaKeys = Object.keys(achievementsResponseSchema.shape).sort();

      // Then
      expect(Object.keys(documented).sort()).toEqual(schemaKeys);
    });
  });

  describe('Scenario: a response carries a field the contract never promised', () => {
    it('strips the unexpected field', () => {
      // Given
      const leaked = {
        unlocked_achievements: [],
        next_available_achievements: [],
        current_badge: 'Beginner',
        next_badge: null,
        remaining_to_unlock_next_badge: 0,
        internal_user_email: 'ada@example.com',
      };

      // When
      const parsed = achievementsResponseSchema.parse(leaked);

      // Then
      expect(parsed).not.toHaveProperty('internal_user_email');
      expect(Object.keys(parsed).sort()).toEqual(
        Object.keys(achievementsResponseSchema.shape).sort(),
      );
    });
  });
});
