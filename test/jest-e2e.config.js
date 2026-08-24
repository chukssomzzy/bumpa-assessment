module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testRegex: 'test/e2e/.*\\.spec\\.ts$',
  // Must run before the specs read WEBHOOK_SECRET / PAYSTACK_SECRET_KEY at module scope.
  setupFiles: ['<rootDir>/test/setup/e2e-env.ts'],
  testTimeout: 180_000,
  maxWorkers: 1,
  moduleFileExtensions: ['js', 'json', 'ts'],
};
