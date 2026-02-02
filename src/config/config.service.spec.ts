import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { ConfigService } from './config.service';
import configuration from './configuration';

describe('ConfigService', () => {
  let service: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({
          load: [configuration],
          ignoreEnvFile: true, // Don't load .env in tests
        }),
      ],
      providers: [ConfigService],
    }).compile();

    service = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Environment', () => {
    it('should return node environment', () => {
      expect(service.nodeEnv).toBeDefined();
      expect(typeof service.nodeEnv).toBe('string');
    });

    it('should return port number', () => {
      expect(service.port).toBeDefined();
      expect(typeof service.port).toBe('number');
    });

    it('should detect development environment', () => {
      expect(typeof service.isDevelopment).toBe('boolean');
    });

    it('should detect production environment', () => {
      expect(typeof service.isProduction).toBe('boolean');
    });
  });

  describe('Database', () => {
    it('should return database host', () => {
      expect(service.databaseHost).toBeDefined();
      expect(typeof service.databaseHost).toBe('string');
    });

    it('should return database port', () => {
      expect(service.databasePort).toBeDefined();
      expect(typeof service.databasePort).toBe('number');
    });

    it('should return database name', () => {
      expect(service.databaseName).toBeDefined();
      expect(typeof service.databaseName).toBe('string');
    });

    it('should return pool size as number', () => {
      expect(service.databasePoolSize).toBeDefined();
      expect(typeof service.databasePoolSize).toBe('number');
      expect(service.databasePoolSize).toBeGreaterThan(0);
    });
  });

  describe('JWT', () => {
    beforeEach(() => {
      // Mock development environment to avoid JWT_SECRET validation in production
      jest.spyOn(service, 'isProduction', 'get').mockReturnValue(false);
    });

    it('should return JWT secret', () => {
      expect(service.jwtSecret).toBeDefined();
      expect(typeof service.jwtSecret).toBe('string');
    });

    it('should return JWT expiration', () => {
      expect(service.jwtExpiresIn).toBeDefined();
      expect(typeof service.jwtExpiresIn).toBe('string');
    });
  });

  describe('OpenAI', () => {
    it('should return OpenAI model', () => {
      expect(service.openaiModel).toBeDefined();
      expect(typeof service.openaiModel).toBe('string');
    });

    it('should return max tokens as number', () => {
      expect(service.openaiMaxTokens).toBeDefined();
      expect(typeof service.openaiMaxTokens).toBe('number');
    });
  });

  describe('Features', () => {
    it('should return chat enabled flag', () => {
      expect(typeof service.chatEnabled).toBe('boolean');
    });

    it('should return AI enabled flag', () => {
      expect(typeof service.aiEnabled).toBe('boolean');
    });

    it('should return file upload enabled flag', () => {
      expect(typeof service.fileUploadEnabled).toBe('boolean');
    });
  });

  describe('Generic access', () => {
    it('should get value by path', () => {
      const port = service.get<number>('port');
      expect(port).toBeDefined();
      expect(typeof port).toBe('number');
    });

    it('should get nested value by path', () => {
      const dbHost = service.get<string>('database.host');
      expect(dbHost).toBeDefined();
      expect(typeof dbHost).toBe('string');
    });
  });

  describe('Validation', () => {
    it('should validate config without errors in development', () => {
      // Mock development environment
      jest.spyOn(service, 'isProduction', 'get').mockReturnValue(false);

      expect(() => service.validateConfig()).not.toThrow();
    });
  });
});
