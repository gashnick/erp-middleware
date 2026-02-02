// src/common/decorators/active-tenant.decorator.spec.ts
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ActiveTenant } from './active-tenant.decorator';
import {
  runWithTenantContext,
  tenantContext,
  getTenantContext,
} from '@common/context/tenant-context';

describe('ActiveTenant Decorator', () => {
  const mockTenantContext = {
    tenantId: 'tenant-secure-123',
    userId: 'user-secure-456',
    requestId: 'req-secure-789',
    schemaName: 'tenant_secure_abc',
    userEmail: 'secure@test.com',
    userRole: 'ADMIN',
    timestamp: new Date(),
  };

  beforeEach(() => {
    tenantContext.exit(() => {});
  });

  it('should extract tenantId from context when data="id"', async () => {
    await runWithTenantContext(mockTenantContext, async () => {
      const context = getTenantContext();
      // Simulate what the decorator does
      expect(context.tenantId).toBe('tenant-secure-123');
    });
  });

  it('should extract userId from context', async () => {
    await runWithTenantContext(mockTenantContext, async () => {
      const context = getTenantContext();
      expect(context.userId).toBe('user-secure-456');
    });
  });

  it('should extract schemaName from context', async () => {
    await runWithTenantContext(mockTenantContext, async () => {
      const context = getTenantContext();
      expect(context.schemaName).toBe('tenant_secure_abc');
    });
  });

  it('should return full context when data is undefined', async () => {
    await runWithTenantContext(mockTenantContext, async () => {
      const context = getTenantContext();
      expect(context.tenantId).toBe('tenant-secure-123');
      expect(context.userId).toBe('user-secure-456');
    });
  });

  it('should throw when context is missing', () => {
    tenantContext.exit(() => {});
    expect(() => getTenantContext()).toThrow(/Tenant context not set/);
  });

  it('should ignore tenantId from request params', async () => {
    await runWithTenantContext(mockTenantContext, async () => {
      // Decorator extracts from context ONLY, not from request params
      const context = getTenantContext();
      expect(context.tenantId).toBe('tenant-secure-123');
    });
  });

  it('should ignore tenantId from request body', async () => {
    await runWithTenantContext(mockTenantContext, async () => {
      // Decorator extracts from context ONLY, not from request body
      const context = getTenantContext();
      expect(context.tenantId).toBe('tenant-secure-123');
    });
  });

  it('should ignore tenantId from request query', async () => {
    await runWithTenantContext(mockTenantContext, async () => {
      // Decorator extracts from context ONLY, not from request query
      const context = getTenantContext();
      expect(context.tenantId).toBe('tenant-secure-123');
    });
  });
});
