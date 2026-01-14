import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DeleteResult } from 'typeorm';
import { TenantsService } from './tenants.service';
import { Tenant } from './entities/tenant.entity';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('TenantsService', () => {
  let service: TenantsService;
  let repository: Repository<Tenant>;
  let tenantConnection: TenantConnectionService;

  const mockTenant: Partial<Tenant> = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    companyName: 'Test Company',
    schemaName: 'tenant_123e4567e89b12d3a456426614174000',
    dataSourceType: 'external',
    subscriptionPlan: 'basic',
    status: 'active',
    planLimits: {
      max_users: 3,
      max_storage_mb: 500,
      max_connectors: 1,
      max_api_calls_per_month: 5000,
      features: ['finance_dashboard', 'csv_upload', 'basic_ai'],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
      softDelete: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    };

    const mockTenantConnection = {
      createTenantSchema: jest.fn(),
      deleteTenantSchema: jest.fn(),
      verifyTenantSchema: jest.fn(),
      getTenantTables: jest.fn(),
      getTenantTableCounts: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        {
          provide: getRepositoryToken(Tenant),
          useValue: mockRepository,
        },
        {
          provide: TenantConnectionService,
          useValue: mockTenantConnection,
        },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
    repository = module.get<Repository<Tenant>>(getRepositoryToken(Tenant));
    tenantConnection = module.get<TenantConnectionService>(TenantConnectionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a tenant and its schema', async () => {
      const createDto = {
        companyName: 'Test Company',
        dataSourceType: 'external' as const,
        subscriptionPlan: 'basic' as const,
      };

      jest.spyOn(repository, 'create').mockReturnValue(mockTenant as Tenant);
      jest
        .spyOn(repository, 'save')
        .mockResolvedValueOnce(mockTenant as Tenant)
        .mockResolvedValueOnce(mockTenant as Tenant);
      jest.spyOn(repository, 'findOne').mockResolvedValue(mockTenant as Tenant);
      jest.spyOn(tenantConnection, 'createTenantSchema').mockResolvedValue(undefined);

      const result = await service.create(createDto);

      expect(result).toEqual(mockTenant);
      expect(repository.create).toHaveBeenCalled();
      expect(repository.save).toHaveBeenCalledTimes(2);
      expect(tenantConnection.createTenantSchema).toHaveBeenCalledWith(mockTenant.id as string);
    });

    it('should rollback tenant creation if schema creation fails', async () => {
      const createDto = {
        companyName: 'Test Company',
        dataSourceType: 'external' as const,
        subscriptionPlan: 'basic' as const,
      };

      jest.spyOn(repository, 'create').mockReturnValue(mockTenant as Tenant);
      jest
        .spyOn(repository, 'save')
        .mockResolvedValueOnce(mockTenant as Tenant)
        .mockResolvedValueOnce(mockTenant as Tenant);
      jest
        .spyOn(tenantConnection, 'createTenantSchema')
        .mockRejectedValue(new Error('Schema creation failed'));
      jest.spyOn(repository, 'delete').mockResolvedValue({ affected: 1 } as DeleteResult);

      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);
      expect(repository.delete).toHaveBeenCalledWith(mockTenant.id as string);
    });
  });

  describe('findById', () => {
    it('should return a tenant by id', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(mockTenant as Tenant);

      const result = await service.findById(mockTenant.id as string);

      expect(result).toEqual(mockTenant);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: mockTenant.id as string },
      });
    });

    it('should throw NotFoundException if tenant not found', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      await expect(service.findById('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return all active tenants', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockTenant]),
      };

      jest.spyOn(repository, 'createQueryBuilder').mockReturnValue(mockQueryBuilder as any);

      const result = await service.findAll();

      expect(result).toEqual([mockTenant]);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('tenant.deleted_at IS NULL');
    });
  });

  describe('update', () => {
    it('should update tenant information', async () => {
      const updateDto = {
        companyName: 'Updated Company',
        subscriptionPlan: 'standard' as const,
      };

      jest.spyOn(service, 'findById').mockResolvedValue(mockTenant as Tenant);
      jest.spyOn(repository, 'save').mockResolvedValue({ ...mockTenant, ...updateDto } as Tenant);

      const result = await service.update(mockTenant.id as string, updateDto);

      expect(result.companyName).toBe(updateDto.companyName);
      expect(result.subscriptionPlan).toBe(updateDto.subscriptionPlan);
    });
  });

  describe('softDelete', () => {
    it('should soft delete a tenant', async () => {
      jest.spyOn(service, 'findById').mockResolvedValue(mockTenant as Tenant);
      jest.spyOn(repository, 'softDelete').mockResolvedValue({ affected: 1 } as any);

      await service.softDelete(mockTenant.id as string);

      expect(repository.softDelete).toHaveBeenCalledWith(mockTenant.id as string);
    });
  });

  describe('verifySchema', () => {
    it('should verify tenant schema integrity', async () => {
      const verificationResult = {
        isValid: true,
        expectedTables: ['invoices', 'payments', 'expenses'],
        actualTables: ['invoices', 'payments', 'expenses'],
        missingTables: [],
      };

      jest.spyOn(service, 'findById').mockResolvedValue(mockTenant as Tenant);
      jest.spyOn(tenantConnection, 'verifyTenantSchema').mockResolvedValue(verificationResult);

      const result = await service.verifySchema(mockTenant.id as string);

      expect(result).toEqual(verificationResult);
      expect(result.isValid).toBe(true);
      expect(result.missingTables).toHaveLength(0);
    });
  });

  describe('countByStatus', () => {
    it('should count tenants by status', async () => {
      jest
        .spyOn(repository, 'count')
        .mockResolvedValueOnce(5) // active
        .mockResolvedValueOnce(2) // suspended
        .mockResolvedValueOnce(1); // cancelled

      const result = await service.countByStatus();

      expect(result).toEqual({
        active: 5,
        suspended: 2,
        cancelled: 1,
        total: 8,
      });
    });
  });
});
