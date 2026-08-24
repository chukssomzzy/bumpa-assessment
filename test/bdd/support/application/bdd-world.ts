import { clearQueues, createTestApp, resetDatabase, type TestContext } from './app-harness';

/**
 * The world every BDD scenario runs against: the booted application harness
 * plus the two lifecycle hooks the scenario style depends on.
 *
 * Deliberately a thin facade over `app-harness.ts`, not a second harness. The
 * boot sequence, the truncate deadlock retry, the queue-drain ordering and the
 * seed split all live there and are not re-derived here.
 */
export interface BddWorld extends TestContext {
  /** Returns the world to the state a scenario may assume before its Given. */
  resetScenario(): Promise<void>;
  /** Run after every scenario. See the note on the implementation below. */
  verifyScenario(): void;
}

export const createBddWorld = async (): Promise<BddWorld> => {
  const ctx = await createTestApp();

  return {
    ...ctx,
    resetScenario: async (): Promise<void> => {
      // The order is load-bearing and is the one the integration suites used:
      // truncate + reseed the demo users first, then drop queued work and wait
      // for anything already running to finish, and only then reset the
      // in-memory provider — so a job still in flight cannot append to
      // `provider.attempted` after the reset.
      await resetDatabase(ctx.dataSource);
      await clearQueues(ctx);
      ctx.provider.reset();
    },
    verifyScenario: (): void => {
      // Intentionally a no-op.
      //
      // The reference standard uses `verifyScenario()` to assert that every
      // outbound stub expectation set up by a scenario was actually satisfied.
      // This repo has no outbound stub contract — the only outbound boundary is
      // `FakePaymentProvider`, and the scenarios that care about it assert on
      // `world.provider.attempted` directly, where the assertion is visible next
      // to the behaviour it pins.
      //
      // Inventing new per-scenario assertions here during a pure style/layout
      // refactor would change coverage, which this refactor must not do. The
      // hook is wired into every suite so the lifecycle shape matches the
      // standard and there is one obvious place to add a global check later.
    },
  };
};
