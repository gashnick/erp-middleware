import { Test, TestingModule } from '@nestjs/testing';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { CreateTenantDto } from './dto/create-tenant.dto';

describe('TenantProvisioningService', () => {
  let service: TenantProvisioningService;
  let queryRunnerMock: any;
  let tenantDbMock: any;

  beforeEach(async () => {
    // 1. Create a mock for the QueryRunner (transaction handler)
    queryRunnerMock = {
      query: jest.fn(),
      release: jest.fn(),
    };

    // 2. Create a mock for the DB Service
    tenantDbMock = {
      transaction: jest.fn((callback) => callback(queryRunnerMock)),
      getRunner: jest.fn().mockResolvedValue(queryRunnerMock),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantProvisioningService,
        { provide: TenantQueryRunnerService, useValue: tenantDbMock },
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

    it('should successfully provision a tenant when all steps pass', async () => {
      // Mock plan lookup success
      queryRunnerMock.query.mockResolvedValueOnce([{ id: 'plan-1', trial_days: 0 }]);

      const result = await service.createOrganization(mockUserId, mockDto);

      // Verify the slug and schema naming logic
      expect(result.slug).toBe('test_corp');
      expect(result.schemaName).toContain('tenant_test_corp_');

      // Verify all 5 major SQL steps were called
      // (Plan select, Tenant insert, Sub insert, Create schema, Create table, Update user)
      expect(queryRunnerMock.query).toHaveBeenCalledTimes(6);
      expect(tenantDbMock.transaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException if the plan does not exist', async () => {
      // Mock empty plan result
      queryRunnerMock.query.mockResolvedValueOnce([]);

      await expect(service.createOrganization(mockUserId, mockDto)).rejects.toThrow(
        NotFoundException,
      );

      // Should stop after the first query
      expect(queryRunnerMock.query).toHaveBeenCalledTimes(1);
    });

    it('should throw InternalServerErrorException and rollback if schema creation fails', async () => {
      // 1. Plan lookup success
      queryRunnerMock.query.mockResolvedValueOnce([{ id: 'plan-1', trial_days: 0 }]);
      // 2. Tenant insert success
      queryRunnerMock.query.mockResolvedValueOnce({});
      // 3. Sub insert success
      queryRunnerMock.query.mockResolvedValueOnce({});
      // 4. Schema creation FAIL
      queryRunnerMock.query.mockRejectedValueOnce(new Error('Postgres Permission Denied'));

      await expect(service.createOrganization(mockUserId, mockDto)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('findAll', () => {
    it('should return a list of tenants with joins', async () => {
      const mockTenants = [{ id: '1', name: 'Acme', plan_name: 'free' }];
      queryRunnerMock.query.mockResolvedValueOnce(mockTenants);

      const result = await service.findAll();

      expect(result).toEqual(mockTenants);
      expect(queryRunnerMock.release).toHaveBeenCalled();
    });
  });
});
