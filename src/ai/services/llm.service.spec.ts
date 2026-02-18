import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LLMService } from './llm.service';

describe.skip('LLMService', () => {
  let service: LLMService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LLMService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, string> = {
                AI_PROVIDER: 'openai',
                AI_API_KEY: 'test-key',
                AI_MODEL: 'gpt-4',
              };
              return config[key] || defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<LLMService>(LLMService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateResponse', () => {
    it('should reject responses with PII', () => {
      const responseWithSSN = 'User SSN is 123-45-6789';
      expect(service.validateResponse(responseWithSSN)).toBe(false);
    });

    it('should reject responses with email', () => {
      const responseWithEmail = 'Contact user@example.com for details';
      expect(service.validateResponse(responseWithEmail)).toBe(false);
    });

    it('should accept clean responses', () => {
      const cleanResponse = 'Revenue increased by 25% this quarter';
      expect(service.validateResponse(cleanResponse)).toBe(true);
    });

    it('should reject very short responses', () => {
      expect(service.validateResponse('OK')).toBe(false);
    });
  });
});
