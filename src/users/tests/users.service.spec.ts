import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from '../users.service';
import { TenantQueryRunnerService } from '../../database/tenant-query-runner.service';
import { setTenantContextForJob } from '../../common/context/tenant-context';
import { ConflictException } from '@nestjs/common';

describe('UsersService (Multi-tenant)', () => {
  let service: UsersService;
  let mockDb: Partial<TenantQueryRunnerService>;
  let cleanup: () => void;

  const mockTenantId = '11111111-2222-3333-4444-555555555555';

  beforeEach(async () => {
    // 1. Mock Database
    mockDb = {
      execute: jest.fn(),
    };

    // 2. Mock Context (Simulate Middleware)
    // Use the public helper to set the tenant context for this test
    cleanup = setTenantContextForJob(
      mockTenantId,
      'test-user',
      'req-test',
      `tenant_${mockTenantId.replace(/-/g, '')}`,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: TenantQueryRunnerService, useValue: mockDb }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    if (cleanup) cleanup();
  });

  describe('create', () => {
    it('should create a user scoped to the current tenant', async () => {
      // Arrange
      const dto = { email: 'test@erp.com', password: 'password123', role: 'STAFF' };
      (mockDb.execute as jest.Mock).mockResolvedValue([{ id: 'user-123' }]);

      // Act
      await service.create(mockTenantId, dto as any);

      // Assert: Verify tenant_id was injected automatically
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO public.users'),
        expect.arrayContaining([mockTenantId, dto.email]), // Ensure tenantId is arg $1
      );
    });

    it('should throw ConflictException if email exists in tenant', async () => {
      // Arrange
      const dto = { email: 'duplicate@erp.com', password: 'password123', role: 'STAFF' };
      const pgError = { code: '23505' }; // Unique violation
      (mockDb.execute as jest.Mock).mockRejectedValue(pgError);

      // Act & Assert
      await expect(service.create(mockTenantId, dto as any)).rejects.toThrow(ConflictException);
    });
  });
});
