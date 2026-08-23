module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testRegex: 'test/integration/.*\\.spec\\.ts$',
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/test/setup/after-env.ts'],
  testTimeout: 120_000,
  maxWorkers: 1,
  moduleFileExtensions: ['js', 'json', 'ts'],
};
