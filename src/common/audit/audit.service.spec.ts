import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import * as TenantContext from '../context/tenant-context';

describe('AuditService', () => {
  let service: AuditService;
  let tenantDb: TenantQueryRunnerService;

  const mockTenantId = 'tenant-123';
  const mockUserId = 'user-456';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: TenantQueryRunnerService,
          // Updated to reflect the new executePublic method
          useValue: {
            executePublic: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    tenantDb = module.get<TenantQueryRunnerService>(TenantQueryRunnerService);

    // Mock the context provider
    jest.spyOn(TenantContext, 'getTenantContext').mockReturnValue({
      tenantId: mockTenantId,
      userId: mockUserId,
      ipAddress: '127.0.0.1',
      userAgent: 'Jest-Test',
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getTenantLogs', () => {
    it('should query the public audit table with tenant filtering', async () => {
      const mockLogs = [{ id: 1, action: 'test-action' }];
      (tenantDb.executePublic as jest.Mock).mockResolvedValue(mockLogs);

      const result = await service.getTenantLogs(mockTenantId);

      expect(tenantDb.executePublic).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM public.audit_logs'),
        [mockTenantId],
      );
      expect(result).toEqual(mockLogs);
    });
  });

  describe('log', () => {
    it('should perform a fire-and-forget insertion into public.audit_logs', async () => {
      const auditParams = {
        action: 'INVOICE_CREATED',
        resourceType: 'INVOICE',
        resourceId: 'inv-001',
        metadata: { amount: 100 },
      };

      await service.log(auditParams);

      expect(tenantDb.executePublic).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO public.audit_logs'),
        [
          mockTenantId,
          mockUserId,
          auditParams.action,
          auditParams.resourceType,
          auditParams.resourceId,
          '127.0.0.1',
          'Jest-Test',
          auditParams.metadata,
        ],
      );
    });

    it('should use system fallbacks if context is missing', async () => {
      // Temporarily override context mock for this test
      jest.spyOn(TenantContext, 'getTenantContext').mockReturnValue(null as any);

      await service.log({ action: 'SYSTEM_STARTUP' });

      expect(tenantDb.executePublic).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['SYSTEM', 'SYSTEM']),
      );
    });
  });
});
