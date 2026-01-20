import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from '../users.service';
import { TenantQueryRunnerService } from '../../database/tenant-query-runner.service';
import { TenantContext } from '../../common/context/tenant-context';
import { ConflictException } from '@nestjs/common';

describe('UsersService (Multi-tenant)', () => {
  let service: UsersService;
  let mockDb: Partial<TenantQueryRunnerService>;

  const mockTenantId = '11111111-2222-3333-4444-555555555555';

  beforeEach(async () => {
    // 1. Mock Database
    mockDb = {
      execute: jest.fn(),
    };

    // 2. Mock Context (Simulate Middleware)
    jest.spyOn(TenantContext, 'getTenantId').mockReturnValue(mockTenantId);

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: TenantQueryRunnerService, useValue: mockDb }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('create', () => {
    it('should create a user scoped to the current tenant', async () => {
      // Arrange
      const dto = { email: 'test@erp.com', password: 'password123', role: 'STAFF' };
      (mockDb.execute as jest.Mock).mockResolvedValue([{ id: 'user-123' }]);

      // Act
      await service.create(dto as any);

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
      await expect(service.create(dto as any)).rejects.toThrow(ConflictException);
    });
  });
});
