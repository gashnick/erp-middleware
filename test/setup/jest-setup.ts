import { setupTestApp } from './test-app.bootstrap';

// Extend Jest timeout for all tests
jest.setTimeout(60000);
console.log('[E2E] Jest setup initialized');

// Suppress Console Ninja logs in test environment
// Suppress Console Ninja and query logs in test environment
if (process.env.NODE_ENV === 'test') {
  const originalConsoleLog = console.log;
  console.log = (...args: any[]) => {
    const message = args[0]?.toString() || '';

    // Suppress these logs
    if (
      message.includes('Console Ninja') ||
      message.includes('query:') ||
      message.includes('SELECT') ||
      message.includes('INSERT') ||
      message.includes('TRUNCATE') ||
      message.includes('DELETE')
    ) {
      return;
    }

    originalConsoleLog.apply(console, args);
  };
}
// Global test app initialization
beforeAll(async () => {
  await setupTestApp();
});

// Add custom matchers if needed
expect.extend({
  toBeValidUUID(received: string) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const pass = uuidRegex.test(received);

    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be a valid UUID`
          : `expected ${received} to be a valid UUID`,
    };
  },
});

// Declare custom matcher types
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidUUID(): R;
    }
  }
}
