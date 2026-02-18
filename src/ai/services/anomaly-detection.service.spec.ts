const mockMetricsService = {};
const mockRLSContextService = {};
import { MetricsService } from '../../common/metrics/metrics.service';
import { RLSContextService } from '../../database/rls-context.service';
import { AIInsightsService } from './ai-insights.service';
import { Test, TestingModule } from '@nestjs/testing';
import { AnomalyDetectionService } from './anomaly-detection.service';
import { TenantQueryRunnerService } from '../../database/tenant-query-runner.service';
import { DataSource } from 'typeorm';

describe('AnomalyDetectionService', () => {
  let service: AnomalyDetectionService;
  let queryRunner: TenantQueryRunnerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnomalyDetectionService,
        {
          provide: DataSource,
          useValue: {},
        },
        {
          provide: MetricsService,
          useValue: mockMetricsService,
        },
        {
          provide: RLSContextService,
          useValue: mockRLSContextService,
        },
        TenantQueryRunnerService,
        AIInsightsService,
      ],
    }).compile();

    service = module.get<AnomalyDetectionService>(AnomalyDetectionService);
    queryRunner = module.get<TenantQueryRunnerService>(TenantQueryRunnerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('detectAnomalies', () => {
    it('should return empty array when no anomalies found', async () => {
      jest.spyOn(queryRunner, 'executeQuery').mockResolvedValue([]);

      const result = await service.detectAnomalies('tenant-123');

      expect(result.anomalies).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.highSeverityCount).toBe(0);
    });

    it('should detect expense spikes', async () => {
      const mockData = [
        {
          vendor_name: 'Vendor A',
          total_amount: 15000,
          avg_amount: 5000,
          stddev_amount: 1000,
          month: new Date('2024-01-01'),
        },
      ];

      jest
        .spyOn(queryRunner, 'executeQuery')
        .mockResolvedValueOnce(mockData)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.detectAnomalies('tenant-123');

      expect(result.anomalies.length).toBeGreaterThan(0);
      expect(result.anomalies[0].type).toBe('expense_spike');
    });
  });
});
