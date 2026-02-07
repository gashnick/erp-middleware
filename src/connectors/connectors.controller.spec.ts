import { Test, TestingModule } from '@nestjs/testing';
import { ConnectorsController } from './connectors.controller';
import { EtlService } from '../etl/services/etl.service';
import { ConnectorHealthService } from './connector-health.service';
import * as TenantContext from '@common/context/tenant-context';

describe('ConnectorsController', () => {
  let controller: ConnectorsController;
  let etlService: EtlService;

  const mockTenantId = 'test-tenant-123';
  const mockConnectorId = 'conn-abc-456';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectorsController],
      providers: [
        {
          provide: EtlService,
          useValue: {
            runExternalSync: jest.fn().mockResolvedValue({ total: 5, synced: 5, quarantined: 0 }),
            runInvoiceEtl: jest.fn().mockResolvedValue({ total: 10, synced: 8, quarantined: 2 }),
            getTenantSecret: jest.fn().mockResolvedValue('mock-secret'),
          },
        },
        {
          provide: ConnectorHealthService,
          useValue: {
            handleSyncSuccess: jest.fn().mockResolvedValue(undefined),
            handleSyncFailure: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    controller = module.get<ConnectorsController>(ConnectorsController);
    etlService = module.get<EtlService>(EtlService);

    // Mock context to return our test tenant ID
    jest.spyOn(TenantContext, 'getTenantContext').mockReturnValue({
      tenantId: mockTenantId,
      schemaName: 'tenant_test_123',
      userId: 'test-user',
      userRole: 'ADMIN',
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('triggerSync', () => {
    it('should trigger the external sync process for a specific connector', async () => {
      const result = await controller.triggerSync(mockConnectorId);

      expect(etlService.runExternalSync).toHaveBeenCalledWith(mockTenantId, mockConnectorId);
      // Controller currently returns an accepted response (background/await behavior),
      // so assert the accepted shape rather than the raw ETL result.
      expect(result).toEqual({ accepted: true });
    });

    it('should handle errors from the sync service and return accepted', async () => {
      jest.spyOn(etlService, 'runExternalSync').mockRejectedValue(new Error('Provider timeout'));

      // Controller swallows errors when awaiting in test mode and returns accepted
      const result = await controller.triggerSync(mockConnectorId);
      expect(result).toEqual({ accepted: true });
    });
  });

  describe('uploadCsv', () => {
    it('should trigger the manual ETL process for CSV uploads', async () => {
      // Create a mock file object as expected by NestJS/Multer
      const mockFile = {
        buffer: Buffer.from('external_id,customer_name,amount\n1,Test Customer,100'),
        size: 100,
        originalname: 'test.csv',
      } as Express.Multer.File;

      const result = await controller.uploadCsv(mockFile);

      expect(etlService.runInvoiceEtl).toHaveBeenCalledWith(
        mockTenantId,
        expect.any(Array), // The parsed CSV rows
        'csv_upload',
      );

      expect(result.synced).toBe(8);
      expect(result.quarantined).toBe(2);
    });

    it('should throw BadRequestException if no file is provided', async () => {
      await expect(controller.uploadCsv(null as any)).rejects.toThrow('No file provided.');
    });
  });
});
