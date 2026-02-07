import { Test, TestingModule } from '@nestjs/testing';
import { EtlService } from './etl.service';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { ConnectorHealthService } from '@connectors/connector-health.service';
import { EtlTransformerService } from './etl-transformer.service';
import { QuarantineService } from './quarantine.service';
import { PostgresProvider } from '@connectors/providers/postgres-provider';
import { QuickbooksProvider } from '@connectors/providers/quickbooks-provider';

describe('EtlService', () => {
  let service: EtlService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EtlService,
        {
          provide: TenantQueryRunnerService,
          useValue: {
            getRunner: jest.fn(),
            transaction: jest.fn(),
            upsert: jest.fn(),
            execute: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: TenantProvisioningService,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: ConnectorHealthService,
          useValue: {
            handleSyncSuccess: jest.fn(),
            handleSyncFailure: jest.fn(),
          },
        },
        {
          provide: EtlTransformerService,
          useValue: {
            transformInvoices: jest.fn(),
          },
        },
        {
          provide: QuarantineService,
          useValue: {
            findManyByIds: jest.fn(),
            findById: jest.fn(),
          },
        },
        {
          provide: PostgresProvider,
          useValue: {
            fetchData: jest.fn(),
          },
        },
        {
          provide: QuickbooksProvider,
          useValue: {
            fetchData: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EtlService>(EtlService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
