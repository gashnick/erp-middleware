// src/database/rls-context.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { RLSContextService } from './rls-context.service';
import { QueryRunner } from 'typeorm';
import { runWithTenantContext, UserRole, tenantContext } from '@common/context/tenant-context';

describe('RLSContextService', () => {
  let service: RLSContextService;
  let mockQueryRunner: any;

  beforeEach(async () => {
    mockQueryRunner = {
      query: jest.fn().mockResolvedValue([]),
      manager: {
        connection: {
          createQueryRunner: jest.fn(),
        },
      },
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RLSContextService],
    }).compile();

    service = module.get<RLSContextService>(RLSContextService);
  });

  afterEach(() => {
    tenantContext.exit(() => {});
  });

  describe('setRLSContext()', () => {
    it('should set app.tenant_id session variable for regular tenant users', async () => {
      await runWithTenantContext(
        {
          tenantId: 'tenant-123',
          userId: 'user-456',
          userRole: UserRole.ADMIN,
        },
        async () => {
          await service.setRLSContext(mockQueryRunner);

          expect(mockQueryRunner.query).toHaveBeenCalledWith(
            expect.stringContaining("SET app.tenant_id = 'tenant-123'"),
          );
        },
      );
    });

    it('should set app.tenant_id to SYSTEM_MIGRATION for migration role', async () => {
      await runWithTenantContext(
        {
          tenantId: 'tenant-123',
          userId: 'migration-runner',
          userRole: UserRole.SYSTEM_MIGRATION,
        },
        async () => {
          await service.setRLSContext(mockQueryRunner);

          expect(mockQueryRunner.query).toHaveBeenCalledWith(
            expect.stringContaining("SET app.tenant_id = 'SYSTEM_MIGRATION'"),
          );
        },
      );
    });

    it('should set app.tenant_id to SYSTEM_JOB for job role', async () => {
      await runWithTenantContext(
        {
          tenantId: 'tenant-123',
          userId: 'job-runner',
          userRole: UserRole.SYSTEM_JOB,
        },
        async () => {
          await service.setRLSContext(mockQueryRunner);

          expect(mockQueryRunner.query).toHaveBeenCalledWith(
            expect.stringContaining("SET app.tenant_id = 'SYSTEM_JOB'"),
          );
        },
      );
    });

    it('should set app.tenant_id to SYSTEM_READONLY for readonly role', async () => {
      await runWithTenantContext(
        {
          tenantId: 'tenant-123',
          userId: 'backup-service',
          userRole: UserRole.SYSTEM_READONLY,
        },
        async () => {
          await service.setRLSContext(mockQueryRunner);

          expect(mockQueryRunner.query).toHaveBeenCalledWith(
            expect.stringContaining("SET app.tenant_id = 'SYSTEM_READONLY'"),
          );
        },
      );
    });

    it('should throw error when tenant context is missing', async () => {
      tenantContext.exit(() => {});

      await expect(service.setRLSContext(mockQueryRunner)).rejects.toThrow();
    });

    it('should throw error when tenantId is null', async () => {
      await expect(
        runWithTenantContext(
          {
            tenantId: null as any,
            userId: 'user-456',
            userRole: UserRole.ADMIN,
          },
          async () => {
            await service.setRLSContext(mockQueryRunner);
          },
        ),
      ).rejects.toThrow();
    });
  });

  describe('clearRLSContext()', () => {
    it('should reset app.tenant_id session variable', async () => {
      await runWithTenantContext(
        {
          tenantId: 'tenant-123',
          userId: 'user-456',
          userRole: UserRole.ADMIN,
        },
        async () => {
          await service.clearRLSContext(mockQueryRunner);

          expect(mockQueryRunner.query).toHaveBeenCalledWith('RESET app.tenant_id');
        },
      );
    });

    it('should not throw on error (connection being released)', async () => {
      mockQueryRunner.query.mockRejectedValueOnce(new Error('Connection closed'));

      // Should not throw even if query fails
      await expect(service.clearRLSContext(mockQueryRunner)).resolves.not.toThrow();
    });
  });

  describe('verifyRLSEnforcement()', () => {
    it('should verify that RLS is enforcing isolation', async () => {
      const tmpRunner = {
        query: jest
          .fn()
          .mockRejectedValue(new Error('tenant context required: app.tenant_id not set')),
        connect: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
      };

      mockQueryRunner.manager.connection.createQueryRunner.mockReturnValue(tmpRunner);

      await expect(service.verifyRLSEnforcement(mockQueryRunner)).resolves.not.toThrow();

      expect(tmpRunner.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT 1 FROM invoices'),
      );
    });

    it('should throw error if RLS is NOT enforcing', async () => {
      const tmpRunner = {
        query: jest.fn().mockResolvedValue([{ '?column?': 1 }]), // Query succeeded without context
        connect: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
      };

      mockQueryRunner.manager.connection.createQueryRunner.mockReturnValue(tmpRunner);

      await expect(service.verifyRLSEnforcement(mockQueryRunner)).rejects.toThrow(
        /RLS is not enforcing tenant isolation/,
      );
    });

    it('should clean up temporary runner even on error', async () => {
      const tmpRunner = {
        query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
        connect: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
      };

      mockQueryRunner.manager.connection.createQueryRunner.mockReturnValue(tmpRunner);

      try {
        await service.verifyRLSEnforcement(mockQueryRunner);
      } catch {
        // Expected
      }

      expect(tmpRunner.release).toHaveBeenCalled();
    });
  });

  describe('Security: RLS Context Isolation', () => {
    it('should isolate context between concurrent requests', async () => {
      const calls: string[] = [];

      mockQueryRunner.query.mockImplementation((query: string) => {
        calls.push(query);
        return Promise.resolve([]);
      });

      const promise1 = runWithTenantContext(
        {
          tenantId: 'tenant-aaa',
          userId: 'user-1',
          userRole: UserRole.ADMIN,
        },
        async () => {
          await service.setRLSContext(mockQueryRunner);
        },
      );

      const promise2 = runWithTenantContext(
        {
          tenantId: 'tenant-bbb',
          userId: 'user-2',
          userRole: UserRole.ADMIN,
        },
        async () => {
          await service.setRLSContext(mockQueryRunner);
        },
      );

      await Promise.all([promise1, promise2]);

      // Both tenant IDs should be set (in any order)
      expect(calls).toContainEqual(expect.stringContaining("SET app.tenant_id = 'tenant-aaa'"));
      expect(calls).toContainEqual(expect.stringContaining("SET app.tenant_id = 'tenant-bbb'"));
    });

    it('should NOT allow one system role to bypass another', async () => {
      // SYSTEM_JOB should not be able to set itself as SYSTEM_READONLY
      await runWithTenantContext(
        {
          tenantId: 'tenant-123',
          userId: 'job-runner',
          userRole: UserRole.SYSTEM_JOB,
        },
        async () => {
          await service.setRLSContext(mockQueryRunner);

          // Verify it's set to SYSTEM_JOB, not SYSTEM_READONLY
          expect(mockQueryRunner.query).toHaveBeenCalledWith(
            expect.stringContaining("SET app.tenant_id = 'SYSTEM_JOB'"),
          );
        },
      );
    });
  });
});
