/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  watchman: false,
  testMatch: ['**/tests/integration/**/*.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/.repos/'],
  testTimeout: 180000,
};
