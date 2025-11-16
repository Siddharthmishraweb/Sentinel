export default async (): Promise<void> => {
  // Global teardown for Jest
  // This runs once after all test suites have completed
  
  try {
    // Close any remaining connections
    if (global.testDatabase) {
      await global.testDatabase.close();
    }
    
    if (global.testRedis) {
      await global.testRedis.disconnect();
    }
  } catch (error) {
    console.error('Error during global teardown:', error);
  }
};