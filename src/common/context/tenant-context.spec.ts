// src/common/context/tenant-context.spec.ts
import {
  getTenantContext,
  getTenantId,
  getSchemaName,
  getUserId,
  getRequestId,
  hasTenantContext,
  setTenantContextForJob,
  runWithTenantContext,
  tenantContext,
} from './tenant-context';

describe('TenantContext', () => {
  describe('getTenantContext()', () => {
    it('should throw error when context is missing', () => {
      // Ensure context is cleared
      tenantContext.exit(() => {});

      expect(() => getTenantContext()).toThrow(
        /Tenant context missing. Background tasks must call/,
      );
    });

    it('should return context when set', async () => {
      const mockContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        requestId: 'req-789',
        schemaName: 'tenant_abc',
        userEmail: 'test@example.com',
        userRole: 'ADMIN',
        timestamp: new Date(),
      };

      await runWithTenantContext(mockContext, async () => {
        const context = getTenantContext();
        expect(context.tenantId).toBe('tenant-123');
        expect(context.userId).toBe('user-456');
      });
    });

    it('should not allow SYSTEM fallback', async () => {
      // This test ensures the old behavior (SYSTEM_FALLBACK) is gone
      tenantContext.exit(() => {});

      const thrownError = new Error('Expected getTenantContext to throw');
      try {
        getTenantContext();
        throw thrownError;
      } catch (e) {
        expect(e).not.toBe(thrownError);
        expect(e.message).toContain('context missing');
      }
    });
  });

  describe('getTenantId()', () => {
    it('should return tenantId from context', async () => {
      const mockContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        requestId: 'req-789',
        schemaName: 'tenant_abc',
        userEmail: 'test@example.com',
        userRole: 'ADMIN',
      };

      await runWithTenantContext(mockContext, async () => {
        expect(getTenantId()).toBe('tenant-123');
      });
    });

    it('should throw if context missing', () => {
      tenantContext.exit(() => {});
      expect(() => getTenantId()).toThrow();
    });
  });

  describe('getSchemaName()', () => {
    it('should return schemaName from context', async () => {
      const mockContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        requestId: 'req-789',
        schemaName: 'tenant_abc123',
        userEmail: 'test@example.com',
        userRole: 'ADMIN',
      };

      await runWithTenantContext(mockContext, async () => {
        expect(getSchemaName()).toBe('tenant_abc123');
      });
    });

    it('should throw if context missing', () => {
      tenantContext.exit(() => {});
      expect(() => getSchemaName()).toThrow();
    });
  });

  describe('getUserId()', () => {
    it('should return userId from context', async () => {
      const mockContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        requestId: 'req-789',
        schemaName: 'tenant_abc',
        userEmail: 'test@example.com',
        userRole: 'ADMIN',
      };

      await runWithTenantContext(mockContext, async () => {
        expect(getUserId()).toBe('user-456');
      });
    });

    it('should throw if context missing', () => {
      tenantContext.exit(() => {});
      expect(() => getUserId()).toThrow();
    });
  });

  describe('getRequestId()', () => {
    it('should return requestId from context', async () => {
      const mockContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        requestId: 'req-789',
        schemaName: 'tenant_abc',
        userEmail: 'test@example.com',
        userRole: 'ADMIN',
      };

      await runWithTenantContext(mockContext, async () => {
        expect(getRequestId()).toBe('req-789');
      });
    });

    it('should throw if context missing', () => {
      tenantContext.exit(() => {});
      expect(() => getRequestId()).toThrow();
    });
  });

  describe('hasTenantContext()', () => {
    it('should return true when context is set', async () => {
      const mockContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        requestId: 'req-789',
        schemaName: 'tenant_abc',
        userEmail: 'test@example.com',
        userRole: 'ADMIN',
      };

      await runWithTenantContext(mockContext, async () => {
        expect(hasTenantContext()).toBe(true);
      });
    });

    it('should return false when context is missing', () => {
      tenantContext.exit(() => {});
      expect(hasTenantContext()).toBe(false);
    });
  });

  describe('setTenantContextForJob()', () => {
    it('should set context for background jobs', () => {
      // Capture previous context and ensure cleanup restores it.
      const previous = tenantContext.getStore();

      const cleanup = setTenantContextForJob(
        'tenant-123',
        'job-runner',
        'job-req-789',
        'tenant_abc',
        'job@system.com',
        'SYSTEM_JOB',
      );

      expect(hasTenantContext()).toBe(true);
      expect(getTenantId()).toBe('tenant-123');
      expect(getUserId()).toBe('job-runner');
      expect(getSchemaName()).toBe('tenant_abc');

      // Cleanup restores previous context (or clears if none)
      cleanup();
      expect(tenantContext.getStore()).toBe(previous);
    });

    it('should restore previous context after cleanup', () => {
      // Start from a clean state
      tenantContext.exit(() => {});

      // Capture previous context
      const prev = tenantContext.getStore();

      // Set first context
      const cleanup1 = setTenantContextForJob('tenant-aaa', 'user1', 'req1', 'schema_aaa');
      expect(getTenantId()).toBe('tenant-aaa');

      // Set second context (nested)
      const cleanup2 = setTenantContextForJob('tenant-bbb', 'user2', 'req2', 'schema_bbb');
      expect(getTenantId()).toBe('tenant-bbb');

      // Cleanup second
      cleanup2();
      expect(getTenantId()).toBe('tenant-aaa');

      // Cleanup first restores previous (which may be undefined)
      cleanup1();
      expect(tenantContext.getStore()).toBe(prev);
    });

    it('should generate schemaName if not provided', () => {
      tenantContext.exit(() => {});

      const cleanup = setTenantContextForJob('tenant-123', 'user1', 'req1');
      const expected = `tenant_${'tenant-123'.replace(/-/g, '')}`;
      expect(getSchemaName()).toBe(expected);

      cleanup();
    });

    it('should use default email and role if not provided', () => {
      tenantContext.exit(() => {});

      const cleanup = setTenantContextForJob('tenant-123', 'user1', 'req1');
      const context = getTenantContext();
      expect(context.userEmail).toBe('system@internal');
      expect(context.userRole).toBeDefined();

      cleanup();
    });
  });

  describe('runWithTenantContext()', () => {
    it('should run callback with tenant context', async () => {
      const mockContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        requestId: 'req-789',
        schemaName: 'tenant_abc',
        userEmail: 'test@example.com',
        userRole: 'ADMIN',
      };

      const result = await runWithTenantContext(mockContext, async () => {
        expect(getTenantId()).toBe('tenant-123');
        return 'success';
      });

      expect(result).toBe('success');
    });

    it('should restore context after async callback', async () => {
      tenantContext.exit(() => {});

      const mockContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        requestId: 'req-789',
        schemaName: 'tenant_abc',
        userEmail: 'test@example.com',
        userRole: 'ADMIN',
      };

      await runWithTenantContext(mockContext, async () => {
        expect(hasTenantContext()).toBe(true);
      });

      expect(hasTenantContext()).toBe(false);
    });

    it('should propagate errors from callback', async () => {
      const mockContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        requestId: 'req-789',
        schemaName: 'tenant_abc',
        userEmail: 'test@example.com',
        userRole: 'ADMIN',
      };

      await expect(
        runWithTenantContext(mockContext, async () => {
          throw new Error('Test error');
        }),
      ).rejects.toThrow('Test error');
    });

    it('should require tenantId', async () => {
      // Intentionally testing without tenantId (bypass TS using cast)
      await expect(
        runWithTenantContext({ userId: 'user-456', requestId: 'req-789' } as any, async () => {}),
      ).rejects.toThrow();
    });

    it('should require userId', async () => {
      // Intentionally testing without userId (bypass TS using cast)
      await expect(
        runWithTenantContext(
          { tenantId: 'tenant-123', requestId: 'req-789' } as any,
          async () => {},
        ),
      ).rejects.toThrow();
    });
  });

  describe('Context isolation between concurrent calls', () => {
    it('should maintain isolated contexts in parallel async operations', async () => {
      const context1 = {
        tenantId: 'tenant-aaa',
        userId: 'user-aaa',
        requestId: 'req-aaa',
        schemaName: 'schema_aaa',
        userEmail: 'aaa@test.com',
        userRole: 'ADMIN',
      };

      const context2 = {
        tenantId: 'tenant-bbb',
        userId: 'user-bbb',
        requestId: 'req-bbb',
        schemaName: 'schema_bbb',
        userEmail: 'bbb@test.com',
        userRole: 'STAFF',
      };

      const results = await Promise.all([
        runWithTenantContext(context1, async () => {
          await new Promise((r) => setTimeout(r, 10));
          return getTenantId();
        }),
        runWithTenantContext(context2, async () => {
          await new Promise((r) => setTimeout(r, 5));
          return getTenantId();
        }),
      ]);

      expect(results).toEqual(['tenant-aaa', 'tenant-bbb']);
    });
  });
});
