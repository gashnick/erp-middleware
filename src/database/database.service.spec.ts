import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from './database.service';
import { ConfigService } from '../config/config.service';
import { DataSource } from 'typeorm';

describe('DatabaseService', () => {
  let service: DatabaseService;
  let dataSource: DataSource;
  let configService: ConfigService;

  beforeEach(async () => {
    // Mock DataSource
    const mockDataSource = {
      query: jest.fn(),
    };

    // Mock ConfigService
    const mockConfigService = {
      databaseName: 'erp_middleware_test',
      databaseHost: 'localhost',
      databasePort: 5432,
      databasePoolSize: 20,
      databaseConnectionTimeout: 5000,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<DatabaseService>(DatabaseService);
    dataSource = module.get<DataSource>(DataSource);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkConnection', () => {
    it('should return true when connection is healthy', async () => {
      jest.spyOn(dataSource, 'query').mockResolvedValue([{ result: 1 }]);

      const result = await service.checkConnection();

      expect(result).toBe(true);
      expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('should return false when connection fails', async () => {
      jest.spyOn(dataSource, 'query').mockRejectedValue(new Error('Connection failed'));

      const result = await service.checkConnection();

      expect(result).toBe(false);
    });
  });

  describe('getMasterDataSource', () => {
    it('should return the master data source', () => {
      const result = service.getMasterDataSource();

      expect(result).toBe(dataSource);
    });
  });

  describe('executeQuery', () => {
    it('should execute a query and return results', async () => {
      const mockResults = [{ id: 1, name: 'Test' }];
      jest.spyOn(dataSource, 'query').mockResolvedValue(mockResults);

      const result = await service.executeQuery('SELECT * FROM test');

      expect(result).toEqual(mockResults);
      expect(dataSource.query).toHaveBeenCalledWith('SELECT * FROM test', undefined);
    });

    it('should execute a query with parameters', async () => {
      const mockResults = [{ id: 1 }];
      jest.spyOn(dataSource, 'query').mockResolvedValue(mockResults);

      const result = await service.executeQuery('SELECT * FROM test WHERE id = $1', [1]);

      expect(result).toEqual(mockResults);
      expect(dataSource.query).toHaveBeenCalledWith('SELECT * FROM test WHERE id = $1', [1]);
    });
  });

  describe('schemaExists', () => {
    it('should return true if schema exists', async () => {
      jest.spyOn(dataSource, 'query').mockResolvedValue([{ exists: true }]);

      const result = await service.schemaExists('tenant_123');

      expect(result).toBe(true);
    });

    it('should return false if schema does not exist', async () => {
      jest.spyOn(dataSource, 'query').mockResolvedValue([{ exists: false }]);

      const result = await service.schemaExists('tenant_999');

      expect(result).toBe(false);
    });
  });

  describe('getPoolStats', () => {
    it('should return pool configuration', () => {
      const stats = service.getPoolStats();

      expect(stats).toEqual({
        maxConnections: 20,
        activeConnections: 0,
        idleConnections: 0,
      });
    });
  });

  describe('getDatabaseStats', () => {
    it('should return database statistics', async () => {
      jest.spyOn(service, 'checkConnection').mockResolvedValue(true);

      jest
        .spyOn(service, 'executeQuery')
        .mockResolvedValueOnce([{ count: '5' }]) // tenants
        .mockResolvedValueOnce([{ count: '10' }]); // users

      const stats = await service.getDatabaseStats();

      expect(stats).toEqual({
        isConnected: true,
        database: 'erp_middleware_test',
        host: 'localhost',
        port: 5432,
        totalTenants: 5,
        totalUsers: 10,
      });
    });

    it('should return zero counts when not connected', async () => {
      jest.spyOn(service, 'checkConnection').mockResolvedValue(false);

      const stats = await service.getDatabaseStats();

      expect(stats.isConnected).toBe(false);
      expect(stats.totalTenants).toBe(0);
      expect(stats.totalUsers).toBe(0);
    });
  });
});
