// src/users/users.service.spec.ts
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
    mockDb = {
      executePublic: jest.fn(),
    };

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
    jest.restoreAllMocks();
  });

  describe('create', () => {
    it('should create a user in the public schema scoped to the tenant', async () => {
      const dto = {
        email: 'test@erp.com',
        password: 'password123',
        role: 'STAFF',
        fullName: 'Test User',
      };
      (mockDb.executePublic as jest.Mock).mockResolvedValue([{ id: 'user-123' }]);

      await service.create(mockTenantId, dto as any);

      expect(mockDb.executePublic).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO public.users'),
        expect.arrayContaining([mockTenantId, dto.email]),
      );
    });

    it('should throw ConflictException if unique constraint (23505) is violated', async () => {
      const dto = { email: 'duplicate@erp.com', password: 'password123', role: 'STAFF' };
      const pgError = new Error('Unique violation');
      (pgError as any).code = '23505';

      (mockDb.executePublic as jest.Mock).mockRejectedValue(pgError);

      await expect(service.create(mockTenantId, dto as any)).rejects.toThrow(ConflictException);
    });
  });

  describe('findByEmail', () => {
    it('should query the public users table with tenant isolation', async () => {
      (mockDb.executePublic as jest.Mock).mockResolvedValue([
        { id: 'user-123', email: 'test@erp.com' },
      ]);

      await service.findByEmail('test@erp.com', mockTenantId);

      expect(mockDb.executePublic).toHaveBeenCalledWith(
        expect.stringContaining('SELECT u.id, u.email'),
        ['test@erp.com', mockTenantId],
      );
      expect(mockDb.executePublic).toHaveBeenCalledWith(
        expect.stringContaining('AND u.tenant_id = $2'),
        expect.anything(),
      );
    });
  });
});
