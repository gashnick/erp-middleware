import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, QueryRunner } from 'typeorm';
import { TenantQueryRunnerService } from './tenant-query-runner.service';
import { tenantContext } from '../common/context/tenant-context';
import { MetricsService } from '@common/metrics/metrics.service';
import { RLSContextService } from './rls-context.service';
import { InternalServerErrorException } from '@nestjs/common';

describe('TenantQueryRunnerService', () => {
  let service: TenantQueryRunnerService;
  let dataSource: jest.Mocked<DataSource>;
  let mockQueryRunner: jest.Mocked<QueryRunner>;
  let mockMetricsService: jest.Mocked<MetricsService>;
  let mockRLSContextService: jest.Mocked<RLSContextService>;

  beforeEach(async () => {
    mockQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: false,
    } as any;

    const mockDataSource = {
      createQueryRunner: jest.fn(() => mockQueryRunner),
      query: jest.fn().mockResolvedValue([{ exists: true }]),
    };

    const mockMetricsServiceValue = {
      recordSchemaSwitchDuration: jest.fn(),
    };

    const mockRLSValue = {
      setRLSContext: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantQueryRunnerService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: MetricsService, useValue: mockMetricsServiceValue },
        { provide: 'RLSContextService', useValue: mockRLSValue },
      ],
    }).compile();

    service = module.get<TenantQueryRunnerService>(TenantQueryRunnerService);
    dataSource = module.get<DataSource>(DataSource) as jest.Mocked<DataSource>;
    mockMetricsService = module.get<MetricsService>(MetricsService) as jest.Mocked<MetricsService>;
    mockRLSContextService = module.get<RLSContextService>('RLSContextService') as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Helper to wrap tests in AsyncLocalStorage context
  const runWithContext = (data: any, cb: () => Promise<void>) => {
    return tenantContext.run(data, cb);
  };

  describe('validateSchemaName (Strict Security Pattern)', () => {
    it('should validate standard tenant schema names with hash', () => {
      const validName = 'tenant_google_cloud_a1b2c3d4';
      expect(() => (service as any).validateSchemaName(validName)).not.toThrow();
    });

    it('should reject names with invalid formats', () => {
      expect(() => (service as any).validateSchemaName('not_a_tenant_schema')).toThrow(
        InternalServerErrorException,
      );
    });

    it('should reject SQL injection attempts', () => {
      const malicious = "tenant_slug_123'; DROP TABLE users; --";
      expect(() => (service as any).validateSchemaName(malicious)).toThrow();
    });
  });

  describe('transaction execution', () => {
    const contextData = {
      tenantId: 't-123',
      schemaName: 'tenant_acme_corp_550e8400',
      requestId: 'req-1',
    };

    it('should set search_path using secure set_config pattern', async () => {
      await runWithContext(contextData, async () => {
        await service.transaction(async (runner) => {
          expect(runner.query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', [
            'search_path',
            `"tenant_acme_corp_550e8400",public`,
          ]);
          return true;
        });
      });

      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should apply RLS context if RLS service is present', async () => {
      await runWithContext(contextData, async () => {
        await service.transaction(async () => {});
        expect(mockRLSContextService.setRLSContext).toHaveBeenCalledWith(mockQueryRunner);
      });
    });

    it('should verify schema existence once and cache it', async () => {
      dataSource.query.mockResolvedValueOnce([{ exists: true }]);

      await runWithContext(contextData, async () => {
        await service.transaction(async () => {});
        await service.transaction(async () => {});
      });

      // Verification should only happen once for the same schema
      expect(dataSource.query).toHaveBeenCalledTimes(1);
    });

    it('should skip schema check if explicitly requested in options', async () => {
      await runWithContext(contextData, async () => {
        await service.transaction(async () => {}, { skipSchemaCheck: true });
      });

      expect(dataSource.query).not.toHaveBeenCalledWith(
        expect.stringContaining('information_schema.schemata'),
        expect.anything(),
      );
    });
  });

  describe('Isolation & Safety', () => {
    it('should throw if tenant context is missing', async () => {
      await expect(service.transaction(async () => {})).rejects.toThrow('Tenant context missing');
    });

    it('should rollback and release runner on work failure', async () => {
      const contextData = { schemaName: 'tenant_fail_123' };
      (mockQueryRunner as any).isTransactionActive = true;

      await runWithContext(contextData, async () => {
        const work = async () => {
          throw new Error('Query Failed');
        };

        await expect(service.transaction(work)).rejects.toThrow('Query Failed');
        expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
        expect(mockQueryRunner.release).toHaveBeenCalled();
      });
    });
  });

  describe('Public Shortcuts', () => {
    it('should executePublic strictly in the public schema', async () => {
      await runWithContext({ schemaName: 'tenant_hidden' }, async () => {
        await service.executePublic('SELECT 1');

        expect(mockQueryRunner.query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', [
          'search_path',
          'public',
        ]);
      });
    });
  });
});
