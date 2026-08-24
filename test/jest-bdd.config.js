module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testMatch: ['<rootDir>/test/bdd/**/*.bdd-spec.ts'],
  // This repo's own Testcontainers bootstrap: it starts the shared Postgres +
  // Redis pair, runs migrations and seeds the definitions once for the whole
  // run, then publishes the connection details for the workers. Kept as-is.
  // What is deliberately NOT copied from the reference standard is its
  // `test/bdd/support/infrastructure/` provisioning, its swagger AST
  // transformer and its `BDD_MAX_WORKERS` validation — those solve problems
  // this repo does not have.
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/test/setup/after-env.ts'],
  testTimeout: 120_000,
  // The reference standard runs 2 workers. It must stay 1 here: every BDD suite
  // shares ONE Testcontainers Postgres + Redis pair (see CONTEXT.md), and two
  // suites truncating and obliterating the same database and queues in parallel
  // reintroduces flakiness this repo has already paid to remove.
  maxWorkers: 1,
  // No `moduleNameMapper`: the reference imports through `src/...` and
  // `test/bdd/support/...` aliases, this repo resolves test imports relatively
  // and has no tsconfig `paths` to match.
  moduleFileExtensions: ['js', 'json', 'ts'],
};
