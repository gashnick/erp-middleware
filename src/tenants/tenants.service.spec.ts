// src/tenants/tenant-provisioning.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { TenantMigrationRunnerService } from '@database/tenant-migration-runner.service';
import { EncryptionService } from '@common/security/encryption.service';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { QueryRunner } from 'typeorm';

describe('TenantProvisioningService', () => {
  let service: TenantProvisioningService;
  let tenantDbMock: jest.Mocked<TenantQueryRunnerService>;
  let queryRunnerMock: jest.Mocked<QueryRunner>;

  beforeEach(async () => {
    queryRunnerMock = {
      query: jest.fn(),
      release: jest.fn(),
    } as any;

    tenantDbMock = {
      // Logic to execute the callback passed to transaction()
      transaction: jest.fn((callback) => callback(queryRunnerMock)),
      executePublic: jest.fn().mockResolvedValue([]),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantProvisioningService,
        { provide: TenantQueryRunnerService, useValue: tenantDbMock },
        {
          provide: TenantMigrationRunnerService,
          useValue: { runMigrations: jest.fn().mockResolvedValue({ errors: [] }) },
        },
        {
          provide: EncryptionService,
          useValue: {
            generateTenantSecret: jest.fn().mockReturnValue('raw-secret'),
            encrypt: jest.fn().mockReturnValue('encrypted-secret'),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('GLOBAL_MASTER_KEY') },
        },
      ],
    }).compile();

    service = module.get<TenantProvisioningService>(TenantProvisioningService);
  });

  describe('createOrganization', () => {
    const mockUserId = 'user-uuid';
    const mockDto: CreateTenantDto = {
      companyName: 'Test Corp',
      subscriptionPlan: 'free',
      dataSourceType: 'external',
    };

    it('should successfully provision a tenant with public context', async () => {
      queryRunnerMock.query.mockResolvedValueOnce([{ id: 'plan-1', trial_days: 0 }]);

      const result = await service.createOrganization(mockUserId, mockDto);

      expect(result.slug).toBe('test_corp');

      // Verify transaction context object
      expect(tenantDbMock.transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ schema: 'public' }),
      );

      expect(queryRunnerMock.query).toHaveBeenCalledTimes(6);
    });

    it('should trigger compensating actions using executePublic on failure', async () => {
      queryRunnerMock.query.mockResolvedValueOnce([{ id: 'plan-1' }]);
      queryRunnerMock.query.mockRejectedValueOnce(new Error('Schema Creation Failed'));

      await expect(service.createOrganization(mockUserId, mockDto)).rejects.toThrow();

      // Verify rollback uses executePublic
      expect(tenantDbMock.executePublic).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM public.tenants'),
        expect.any(Array),
      );
    });
  });

  describe('findAll', () => {
    it('should use executePublic to fetch tenant list', async () => {
      const mockTenants = [{ id: '1', name: 'Acme' }];
      tenantDbMock.executePublic.mockResolvedValueOnce(mockTenants);

      const result = await service.findAll();

      expect(result).toEqual(mockTenants);
      expect(tenantDbMock.executePublic).toHaveBeenCalled();
    });
  });
});
