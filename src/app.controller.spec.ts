import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(() => {
    // Instantiate controller directly with a mock ConfigService to avoid
    // dependency injection complexity in the unit test harness.
    const mockConfigService = {
      nodeEnv: 'test',
      port: 3000,
      databaseHost: 'localhost',
      databaseName: 'testdb',
      jwtSecret: 'change-me-in-production',
    } as any;

    appController = new AppController(new AppService(), mockConfigService);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
