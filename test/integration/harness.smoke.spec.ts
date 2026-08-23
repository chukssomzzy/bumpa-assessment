import { DEMO_USER_ID, createTestApp, resetDatabase, type TestContext } from '../setup/harness';
import { ACHIEVEMENT_DEFINITIONS, BADGE_DEFINITIONS } from '../../src/database/seeds/definitions';

describe('integration harness', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
  });

  it('boots the app against real postgres and redis with definitions seeded', async () => {
    const achievements = await ctx.dataSource.query('SELECT key FROM achievements ORDER BY tier');
    const badges = await ctx.dataSource.query(
      'SELECT key FROM badges ORDER BY required_achievement_count',
    );
    const users = await ctx.dataSource.query('SELECT id FROM users WHERE id = $1', [DEMO_USER_ID]);

    expect(achievements).toHaveLength(ACHIEVEMENT_DEFINITIONS.length);
    expect(badges).toHaveLength(BADGE_DEFINITIONS.length);
    expect(users).toHaveLength(1);
  });

  it('grants the demo user the zero-requirement badge without a payout', async () => {
    const badges = await ctx.dataSource.query(
      'SELECT badge_key FROM user_badges WHERE user_id = $1',
      [DEMO_USER_ID],
    );
    const payouts = await ctx.dataSource.query('SELECT id FROM payouts WHERE user_id = $1', [
      DEMO_USER_ID,
    ]);

    expect(badges).toEqual([{ badge_key: 'beginner' }]);
    expect(payouts).toHaveLength(0);
  });
});
