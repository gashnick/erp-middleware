// src/finance/invoices/invoices.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { InvoicesService } from './invoices.service';
import { TenantQueryRunnerService } from '../../database/tenant-query-runner.service';
import * as TenantContext from '../../common/context/tenant-context';

describe('InvoicesService', () => {
  let service: InvoicesService;
  let tenantQueryRunner: TenantQueryRunnerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        {
          provide: TenantQueryRunnerService,
          useValue: {
            execute: jest.fn(),
            transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
    tenantQueryRunner = module.get<TenantQueryRunnerService>(TenantQueryRunnerService);

    // Mock tenant context
    jest.spyOn(TenantContext, 'getTenantContext').mockReturnValue({
      tenantId: 'test-tenant-id',
      userId: 'test-user-id',
      requestId: 'test-request-id',
      schemaName: 'tenant_test',
      userEmail: 'test@example.com',
      userRole: 'admin',
      timestamp: new Date(),
    });

    jest.spyOn(TenantContext, 'getTenantId').mockReturnValue('test-tenant-id');
    jest.spyOn(TenantContext, 'getUserId').mockReturnValue('test-user-id');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should find all invoices', async () => {
    const mockInvoices = [
      { id: '1', invoice_number: 'INV-001', amount: 1000 },
      { id: '2', invoice_number: 'INV-002', amount: 2000 },
    ];

    jest.spyOn(tenantQueryRunner, 'execute').mockResolvedValue(mockInvoices);

    const result = await service.findAll();

    expect(result).toEqual(mockInvoices);
    expect(tenantQueryRunner.execute).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM invoices'),
    );
  });

  it('should create invoice with transaction', async () => {
    const mockInvoice = { id: '1', invoice_number: 'INV-001', amount: 1000 };

    jest.spyOn(tenantQueryRunner, 'transaction').mockImplementation(async (work) => {
      const mockRunner = {
        query: jest.fn().mockResolvedValue([mockInvoice]),
      };
      return work(mockRunner as any);
    });

    const result = await service.create({
      invoice_number: 'INV-001',
      customer_name: 'Test Customer',
      amount: 1000,
    });

    expect(result).toEqual(mockInvoice);
    expect(tenantQueryRunner.transaction).toHaveBeenCalled();
  });
});
