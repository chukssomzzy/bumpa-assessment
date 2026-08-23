module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testRegex: 'src/.*\\.spec\\.ts$',
  collectCoverageFrom: ['src/**/domain/**/*.ts'],
  moduleFileExtensions: ['js', 'json', 'ts'],
};
