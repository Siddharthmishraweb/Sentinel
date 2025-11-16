module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/integration/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testTimeout: 60000,
  maxWorkers: 1,
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup.ts'
  ],
  globalTeardown: '<rootDir>/tests/teardown.ts',
};