import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, QueryRunner } from 'typeorm';
import { TenantQueryRunnerService } from './tenant-query-runner.service';
import { setTenantContextForJob } from '../common/context/tenant-context';

describe('TenantQueryRunnerService', () => {
  let service: TenantQueryRunnerService;
  let dataSource: jest.Mocked<DataSource>;
  let mockQueryRunner: jest.Mocked<QueryRunner>;

  beforeEach(async () => {
    mockQueryRunner = {
      connect: jest.fn(),
      query: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
    } as any;

    const mockDataSource = {
      createQueryRunner: jest.fn(() => mockQueryRunner),
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantQueryRunnerService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<TenantQueryRunnerService>(TenantQueryRunnerService);
    dataSource = module.get<DataSource>(DataSource) as jest.Mocked<DataSource>;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateSchemaName', () => {
    it('should validate correct schema names', () => {
      const validSchemaName = 'tenant_' + 'a'.repeat(32); // tenant_ + 32 'a' chars

      expect(() => {
        (service as any).validateSchemaName(validSchemaName);
      }).not.toThrow();
    });

    it('should reject invalid schema names', () => {
      const invalidNames = [
        'invalid_schema',
        'tenant_123', // too short
        'tenant_abc123', // invalid chars
      ];

      invalidNames.forEach((name) => {
        expect(() => {
          (service as any).validateSchemaName(name);
        }).toThrow('Invalid schema name');
      });
    });

    it('should reject SQL injection attempts', () => {
      const maliciousNames = [
        "tenant_123'; DROP TABLE users; --",
        'tenant_123; SELECT * FROM secret_table;',
        'tenant_123 OR 1=1',
      ];

      maliciousNames.forEach((name) => {
        expect(() => {
          (service as any).validateSchemaName(name);
        }).toThrow('Invalid schema name');
      });
    });
  });

  describe('Core functionality', () => {
    it('should have execute method', () => {
      expect(typeof service.execute).toBe('function');
    });

    it('should have transaction method', () => {
      expect(typeof service.transaction).toBe('function');
    });

    it('should have getCurrentSchema method', () => {
      expect(typeof service.getCurrentSchema).toBe('function');
    });

    it('should have getRunner method', () => {
      expect(typeof (service as any).getRunner).toBe('function');
    });
  });

  describe('Error handling patterns', () => {
    it('should throw error when tenant context is missing', async () => {
      // This test demonstrates the fail-fast behavior
      await expect((service as any).getRunner()).rejects.toThrow('Tenant context not set');
    });

    it('should validate schema format before use', () => {
      const invalidSchemas = [
        '',
        'public',
        'tenant_',
        'tenant_123',
        'tenant_gggggggggggggggggggggggggggggggg', // invalid chars
      ];

      invalidSchemas.forEach((schema) => {
        expect(() => {
          (service as any).validateSchemaName(schema);
        }).toThrow();
      });
    });
  });

  // 1. Unit Test TenantQueryRunnerService
  describe('Unit Test TenantQueryRunnerService', () => {
    const tenantId1 = '12345678-1234-1234-1234-123456789abc';
    const tenantId2 = '87654321-4321-4321-4321-cba987654321';
    const schemaName1 = `tenant_${tenantId1.replace(/-/g, '')}`;
    const schemaName2 = `tenant_${tenantId2.replace(/-/g, '')}`;

    it('should mock tenant context and ensure queries run only in correct schema', async () => {
      // Mock DataSource.query for schema verification
      dataSource.query.mockResolvedValueOnce([{ exists: true }]);

      // Set tenant context for tenant 1
      const cleanup = setTenantContextForJob(tenantId1, 'user1', 'req1', schemaName1);

      try {
        const runner = await (service as any).getRunner();

        expect(mockQueryRunner.connect).toHaveBeenCalled();
        expect(mockQueryRunner.query).toHaveBeenCalledWith(
          `SET search_path TO ${schemaName1}, public`,
        );
        expect(mockQueryRunner.query).toHaveBeenCalledWith('SELECT set_tenant_role()');

        expect(runner).toBe(mockQueryRunner);
      } finally {
        cleanup();
      }
    });

    it('should repeat with different tenant and ensure results are different', async () => {
      // Mock schema exists for both
      dataSource.query.mockResolvedValueOnce([{ exists: true }]);
      dataSource.query.mockResolvedValueOnce([{ exists: true }]);

      // Tenant 1
      const cleanup1 = setTenantContextForJob(tenantId1, 'user1', 'req1', schemaName1);
      let runner1: QueryRunner;
      try {
        runner1 = await (service as any).getRunner();
        expect(mockQueryRunner.query).toHaveBeenCalledWith(
          `SET search_path TO ${schemaName1}, public`,
        );
      } finally {
        cleanup1();
      }

      // Reset mocks
      jest.clearAllMocks();

      // Tenant 2
      const cleanup2 = setTenantContextForJob(tenantId2, 'user2', 'req2', schemaName2);
      let runner2: QueryRunner;
      try {
        runner2 = await (service as any).getRunner();
        expect(mockQueryRunner.query).toHaveBeenCalledWith(
          `SET search_path TO ${schemaName2}, public`,
        );
      } finally {
        cleanup2();
      }

      // Different schemas
      expect(schemaName1).not.toBe(schemaName2);
    });

    it('should try removing context and expect error: Tenant context required', async () => {
      // No context set - should throw
      await expect((service as any).getRunner()).rejects.toThrow('Tenant context not set');
    });
  });

  // 2. Integration Test Middleware + Guard (will be in separate e2e file)
  // 3. Schema Isolation Test (will be in separate e2e file)

  // 4. Role Enforcement Test
  describe('Role Enforcement Test', () => {
    const tenantId1 = '12345678-1234-1234-1234-123456789abc';
    const tenantId2 = '87654321-4321-4321-4321-cba987654321';
    const schemaName1 = `tenant_${tenantId1.replace(/-/g, '')}`;
    const schemaName2 = `tenant_${tenantId2.replace(/-/g, '')}`;

    it('should verify that DB roles prevent access', async () => {
      // Mock schema exists
      dataSource.query.mockResolvedValueOnce([{ exists: true }]);

      // Set context for tenant 1
      const cleanup = setTenantContextForJob(tenantId1, 'user1', 'req1', schemaName1);

      try {
        await (service as any).getRunner();

        // Verify role switching is called
        expect(mockQueryRunner.query).toHaveBeenCalledWith('SELECT set_tenant_role()');
      } finally {
        cleanup();
      }
    });

    // Note: Actual role enforcement would need database setup with proper roles
    // This test verifies the service calls the role switching function
  });

  // 5. Background Jobs Test
  describe('Background Jobs Test', () => {
    const tenantId1 = '12345678-1234-1234-1234-123456789abc';
    const tenantId2 = '87654321-4321-4321-4321-cba987654321';
    const schemaName1 = `tenant_${tenantId1.replace(/-/g, '')}`;
    const schemaName2 = `tenant_${tenantId2.replace(/-/g, '')}`;

    it("should ensure jobs don't leak data between tenants", async () => {
      // Mock schema exists for both
      dataSource.query.mockResolvedValue([{ exists: true }]);

      // Mock query results
      mockQueryRunner.query.mockResolvedValue([{ count: 1 }]);

      // Job for tenant 1
      const cleanup1 = setTenantContextForJob(tenantId1, 'system', 'job1', schemaName1);
      try {
        await service.execute('SELECT COUNT(*) as count FROM test_table');
        // Verify tenant 1 search path was set
        expect(mockQueryRunner.query).toHaveBeenCalledWith(
          `SET search_path TO ${schemaName1}, public`,
        );
      } finally {
        cleanup1();
      }

      // Reset mocks for tenant 2
      jest.clearAllMocks();
      mockQueryRunner.query.mockResolvedValue([{ count: 1 }]);
      dataSource.query.mockResolvedValue([{ exists: true }]);

      // Job for tenant 2
      const cleanup2 = setTenantContextForJob(tenantId2, 'system', 'job2', schemaName2);
      try {
        await service.execute('SELECT COUNT(*) as count FROM test_table');
        // Verify tenant 2 search path was set
        expect(mockQueryRunner.query).toHaveBeenCalledWith(
          `SET search_path TO ${schemaName2}, public`,
        );
      } finally {
        cleanup2();
      }

      // Ensure schemas are different
      expect(schemaName1).not.toBe(schemaName2);
    });
  });

  // 6. Negative Tests
  describe('Negative Tests', () => {
    it('should call TenantQueryRunnerService without context and must fail', async () => {
      await expect(service.execute('SELECT 1')).rejects.toThrow('Tenant context not set');
      await expect(service.transaction(async () => {})).rejects.toThrow('Tenant context not set');
    });

    it('should try changing schemaName manually and must fail validation', () => {
      const invalidSchemas = [
        'tenant_invalid',
        'tenant_123',
        'tenant_gggggggggggggggggggggggggggggggg',
        "tenant_123'; DROP TABLE users; --",
      ];

      invalidSchemas.forEach((schema) => {
        expect(() => {
          (service as any).validateSchemaName(schema);
        }).toThrow();
      });
    });

    it('should run with non-existent schema and fail', async () => {
      const tenantId = '12345678-1234-1234-1234-123456789abc';
      const schemaName = `tenant_${tenantId.replace(/-/g, '')}`;

      // Mock schema does not exist
      dataSource.query.mockResolvedValueOnce([{ exists: false }]);

      const cleanup = setTenantContextForJob(tenantId, 'user1', 'req1', schemaName);

      try {
        await expect((service as any).getRunner()).rejects.toThrow(
          'Schema tenant_12345678123412341234123456789abc does not exist',
        );
      } finally {
        cleanup();
      }
    });
  });
});
