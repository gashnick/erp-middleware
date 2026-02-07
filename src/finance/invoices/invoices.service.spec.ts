import { Test, TestingModule } from '@nestjs/testing';
import { InvoicesService } from './invoices.service';
import { TenantQueryRunnerService } from '../../database/tenant-query-runner.service';
import * as TenantContext from '../../common/context/tenant-context';
import { EtlService } from '../../etl/services/etl.service';
import { EncryptionService } from '../../common/security/encryption.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('InvoicesService', () => {
  let service: InvoicesService;
  let tenantQueryRunner: TenantQueryRunnerService;
  let etlService: EtlService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        {
          provide: TenantQueryRunnerService,
          useValue: {
            // Updated to match the new Service shortcuts
            executeTenant: jest.fn(),
            executePublic: jest.fn(),
            transaction: jest.fn(),
          },
        },
        {
          provide: EtlService,
          useValue: {
            getTenantSecret: jest.fn().mockResolvedValue('test-secret'),
          },
        },
        {
          provide: EncryptionService,
          useValue: {
            encrypt: jest.fn((v) => `enc:${v}`),
            decrypt: jest.fn((v) => v.replace('enc:', '')),
          },
        },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
    tenantQueryRunner = module.get<TenantQueryRunnerService>(TenantQueryRunnerService);
    etlService = module.get<EtlService>(EtlService);

    // Mock the AsyncLocalStorage context retrieval
    jest.spyOn(TenantContext, 'getTenantContext').mockReturnValue({
      tenantId: 'test-tenant-id',
      userId: 'test-user-id',
      requestId: 'test-request-id',
      schemaName: 'tenant_test_123',
      userEmail: 'test@example.com',
      userRole: 'admin',
      timestamp: new Date(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return decrypted invoices using executeTenant', async () => {
      const mockRows = [
        { id: '1', invoice_number: 'enc:INV-001', customer_name: 'enc:Alice', is_encrypted: true },
      ];

      // Mock executeTenant specifically
      jest.spyOn(tenantQueryRunner, 'executeTenant').mockResolvedValue(mockRows);

      const result = await service.findAll('test-tenant-id');

      // Verify decryption logic was applied
      expect(result[0].customer_name).toBe('Alice');
      expect(result[0].invoice_number).toBe('INV-001');

      // Verify the correct runner method was called
      expect(tenantQueryRunner.executeTenant).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM invoices'),
      );
    });
  });

  describe('create', () => {
    it('should encrypt sensitive data and use executeTenant', async () => {
      const dto = {
        invoice_number: 'INV-999',
        customer_name: 'John Doe',
        amount: 500,
      };

      const mockDbResult = [
        {
          ...dto,
          id: 'new-uuid',
          customer_name: 'enc:John Doe',
          is_encrypted: true,
        },
      ];

      jest.spyOn(tenantQueryRunner, 'executeTenant').mockResolvedValue(mockDbResult);

      const result = await service.create('test-tenant-id', dto);

      // Check if DB was called with encrypted values
      expect(tenantQueryRunner.executeTenant).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO invoices'),
        expect.arrayContaining(['enc:John Doe', 'enc:INV-999']),
      );

      // Result returned to user should be decrypted
      expect(result.customer_name).toBe('John Doe');
    });

    it('should throw ConflictException on duplicate external_id', async () => {
      const error = new Error('Unique constraint violation');
      (error as any).code = '23505'; // Postgres unique_violation code

      jest.spyOn(tenantQueryRunner, 'executeTenant').mockRejectedValue(error);

      await expect(
        service.create('test-tenant-id', {
          customer_name: 'X',
          amount: 1,
          external_id: 'existing-id',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException if invoice does not exist', async () => {
      jest.spyOn(tenantQueryRunner, 'executeTenant').mockResolvedValue([]);

      await expect(service.findOne('bad-id', 'test-tenant-id')).rejects.toThrow(NotFoundException);
    });
  });
});
