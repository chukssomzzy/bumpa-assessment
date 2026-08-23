module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testRegex: 'test/e2e/.*\\.spec\\.ts$',
  testTimeout: 180_000,
  maxWorkers: 1,
  moduleFileExtensions: ['js', 'json', 'ts'],
};
