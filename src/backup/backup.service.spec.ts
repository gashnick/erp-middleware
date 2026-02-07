import { Test, TestingModule } from '@nestjs/testing';
import { BackupService } from './backup.service';
import { ConfigService } from '../config/config.service';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';

describe('BackupService', () => {
  let service: BackupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupService,
        {
          provide: ConfigService,
          useValue: {
            databaseHost: 'localhost',
            databasePort: 5432,
            databaseUsername: 'user',
            databasePassword: 'pass',
            databaseName: 'testdb',
          },
        },
        {
          provide: TenantProvisioningService,
          useValue: {
            findById: jest.fn(),
            findAll: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<BackupService>(BackupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
