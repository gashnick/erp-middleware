import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { DatabaseModule } from '@database/database.module';
import { AnalyticsModule } from '@analytics/analytics.module';
import { AnomalyModule } from '@anomaly/anomaly.module';
import { SummaryPrecomputeProcessor } from './summary-precompute.processor';
import { AnomalyScanProcessor } from './anomaly-scan.processor';

@Module({
  imports: [
    DatabaseModule,
    AnalyticsModule,
    AnomalyModule,
    BullModule.registerQueue({ name: 'summary-precompute' }, { name: 'anomaly-scan' }),
  ],
  providers: [SummaryPrecomputeProcessor, AnomalyScanProcessor],
})
export class JobsModule implements OnModuleInit {
  constructor(@InjectQueue('summary-precompute') private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      'precompute-all',
      {},
      {
        repeat: { cron: '0 1 * * *' },
        removeOnComplete: true,
      },
    );
  }
}
