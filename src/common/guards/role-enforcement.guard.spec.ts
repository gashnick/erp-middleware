// src/common/guards/role-enforcement.guard.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { RoleEnforcementGuard } from './role-enforcement.guard';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { runWithTenantContext, UserRole, tenantContext } from '@common/context/tenant-context';

describe('RoleEnforcementGuard', () => {
  let guard: RoleEnforcementGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RoleEnforcementGuard, Reflector],
    }).compile();

    guard = module.get<RoleEnforcementGuard>(RoleEnforcementGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  afterEach(() => {
    tenantContext.exit(() => {});
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate()', () => {
    it('should allow access when no role requirement is specified', async () => {
      const mockContext = {
        switchToHttp: () => ({}),
        getHandler: () => () => {},
      } as unknown as ExecutionContext;

      jest.spyOn(reflector, 'get').mockReturnValue(null);

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should allow access when user role matches required role', async () => {
      await runWithTenantContext(
        {
          tenantId: 'tenant-123',
          userId: 'migration-runner',
          userRole: UserRole.SYSTEM_MIGRATION,
        },
        async () => {
          const mockContext = {
            switchToHttp: () => ({}),
            getHandler: () => () => {},
          } as unknown as ExecutionContext;

          jest.spyOn(reflector, 'get').mockReturnValue(UserRole.SYSTEM_MIGRATION);

          expect(guard.canActivate(mockContext)).toBe(true);
        },
      );
    });

    it('should deny access when user role does NOT match required role', async () => {
      await runWithTenantContext(
        {
          tenantId: 'tenant-123',
          userId: 'user-456',
          userRole: UserRole.SYSTEM_JOB,
        },
        async () => {
          const mockContext = {
            switchToHttp: () => ({}),
            getHandler: () => () => {},
          } as unknown as ExecutionContext;

          jest.spyOn(reflector, 'get').mockReturnValue(UserRole.SYSTEM_MIGRATION);

          expect(() => guard.canActivate(mockContext)).toThrow(ForbiddenException);
        },
      );
    });

    it('should deny access when context is missing', () => {
      tenantContext.exit(() => {});

      const mockContext = {
        switchToHttp: () => ({}),
        getHandler: () => () => {},
      } as unknown as ExecutionContext;

      jest.spyOn(reflector, 'get').mockReturnValue(UserRole.ADMIN);

      expect(() => guard.canActivate(mockContext)).toThrow(ForbiddenException);
    });
  });

  describe('Privilege minimization: System roles', () => {
    it('should enforce SYSTEM_MIGRATION role separation', async () => {
      await runWithTenantContext(
        {
          tenantId: 'tenant-123',
          userId: 'migration-runner',
          userRole: UserRole.SYSTEM_MIGRATION,
        },
        async () => {
          const mockContext = {
            switchToHttp: () => ({}),
            getHandler: () => () => {},
          } as unknown as ExecutionContext;

          jest.spyOn(reflector, 'get').mockReturnValue(UserRole.SYSTEM_MIGRATION);

          // Migration can run migrations
          expect(guard.canActivate(mockContext)).toBe(true);
        },
      );

      // But cannot run as job runner
      await runWithTenantContext(
        {
          tenantId: 'tenant-123',
          userId: 'migration-runner',
          userRole: UserRole.SYSTEM_MIGRATION,
        },
        async () => {
          const mockContext = {
            switchToHttp: () => ({}),
            getHandler: () => () => {},
          } as unknown as ExecutionContext;

          jest.spyOn(reflector, 'get').mockReturnValue(UserRole.SYSTEM_JOB);

          expect(() => guard.canActivate(mockContext)).toThrow(/Insufficient privileges/);
        },
      );
    });

    it('should enforce SYSTEM_JOB role separation', async () => {
      await runWithTenantContext(
        {
          tenantId: 'tenant-123',
          userId: 'job-runner',
          userRole: UserRole.SYSTEM_JOB,
        },
        async () => {
          const mockContext = {
            switchToHttp: () => ({}),
            getHandler: () => () => {},
          } as unknown as ExecutionContext;

          jest.spyOn(reflector, 'get').mockReturnValue(UserRole.SYSTEM_JOB);

          // Job can run as job
          expect(guard.canActivate(mockContext)).toBe(true);
        },
      );

      // But cannot run migrations
      await runWithTenantContext(
        {
          tenantId: 'tenant-123',
          userId: 'job-runner',
          userRole: UserRole.SYSTEM_JOB,
        },
        async () => {
          const mockContext = {
            switchToHttp: () => ({}),
            getHandler: () => () => {},
          } as unknown as ExecutionContext;

          jest.spyOn(reflector, 'get').mockReturnValue(UserRole.SYSTEM_MIGRATION);

          expect(() => guard.canActivate(mockContext)).toThrow(/Insufficient privileges/);
        },
      );
    });

    it('should enforce SYSTEM_READONLY role separation', async () => {
      await runWithTenantContext(
        {
          tenantId: 'tenant-123',
          userId: 'backup-service',
          userRole: UserRole.SYSTEM_READONLY,
        },
        async () => {
          const mockContext = {
            switchToHttp: () => ({}),
            getHandler: () => () => {},
          } as unknown as ExecutionContext;

          jest.spyOn(reflector, 'get').mockReturnValue(UserRole.SYSTEM_READONLY);

          // Readonly can read
          expect(guard.canActivate(mockContext)).toBe(true);
        },
      );

      // But cannot modify (run as JOB)
      await runWithTenantContext(
        {
          tenantId: 'tenant-123',
          userId: 'backup-service',
          userRole: UserRole.SYSTEM_READONLY,
        },
        async () => {
          const mockContext = {
            switchToHttp: () => ({}),
            getHandler: () => () => {},
          } as unknown as ExecutionContext;

          jest.spyOn(reflector, 'get').mockReturnValue(UserRole.SYSTEM_JOB);

          expect(() => guard.canActivate(mockContext)).toThrow();
        },
      );
    });
  });

  describe('Error handling', () => {
    it('should provide clear error message with required role', async () => {
      await runWithTenantContext(
        {
          tenantId: 'tenant-123',
          userId: 'user-456',
          userRole: UserRole.ANALYST,
        },
        async () => {
          const mockContext = {
            switchToHttp: () => ({}),
            getHandler: () => () => {},
          } as unknown as ExecutionContext;

          jest.spyOn(reflector, 'get').mockReturnValue(UserRole.ADMIN);

          expect(() => guard.canActivate(mockContext)).toThrow(
            new ForbiddenException(`Insufficient privileges. Required role: ${UserRole.ADMIN}`),
          );
        },
      );
    });
  });
});
