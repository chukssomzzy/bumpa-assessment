import {
  ACHIEVEMENT_DEFINITIONS,
  BADGE_DEFINITIONS,
} from '../../../src/database/seeds/definitions';
import { DEMO_USER_ID } from '../support/application/app-harness';
import { createBddWorld, type BddWorld } from '../support/application/bdd-world';

/**
 * The foundation the other four suites stand on: the world really boots against
 * a live Postgres and Redis, and `resetScenario()` really leaves the reference
 * data alone while restoring the demo users. No feature fixtures here on
 * purpose — a fixture failing would hide the very thing this file exists to
 * prove.
 */

describe('Feature: the BDD world boots against real infrastructure', () => {
  let world: BddWorld;

  beforeAll(async () => {
    world = await createBddWorld();
  });

  beforeEach(async () => world.resetScenario());
  afterEach(() => world.verifyScenario());
  afterAll(async () => world?.close());

  describe('Scenario: the world is reset before a scenario runs', () => {
    it('Given a world booted against real postgres and redis, When a scenario reset has run, Then every definition is still seeded and the demo user is restored', async () => {
      // Given
      // (beforeAll booted the world; beforeEach ran resetScenario)

      // When
      const achievements = await world.dataSource.query(
        'SELECT key FROM achievements ORDER BY tier',
      );
      const badges = await world.dataSource.query(
        'SELECT key FROM badges ORDER BY required_achievement_count',
      );
      const users = await world.dataSource.query('SELECT id FROM users WHERE id = $1', [
        DEMO_USER_ID,
      ]);

      // Then
      expect(achievements).toHaveLength(ACHIEVEMENT_DEFINITIONS.length);
      expect(badges).toHaveLength(BADGE_DEFINITIONS.length);
      expect(users).toHaveLength(1);
    });
  });

  describe('Scenario: the demo user is reseeded', () => {
    it('Given a freshly reseeded demo user, When their badges and payouts are read, Then they hold the zero-requirement badge and no payout was minted for it', async () => {
      // Given
      // (beforeEach reseeded the demo user)

      // When
      const badges = await world.dataSource.query(
        'SELECT badge_key FROM user_badges WHERE user_id = $1',
        [DEMO_USER_ID],
      );
      const payouts = await world.dataSource.query('SELECT id FROM payouts WHERE user_id = $1', [
        DEMO_USER_ID,
      ]);

      // Then
      expect(badges).toEqual([{ badge_key: 'beginner' }]);
      expect(payouts).toHaveLength(0);
    });
  });
});
