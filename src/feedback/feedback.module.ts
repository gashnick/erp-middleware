import { Module } from '@nestjs/common';
import { DatabaseModule } from '@database/database.module';
import { FeedbackService } from './feedback.service';
import { FeedbackRepository } from './feedback.repository';
import { FeedbackController } from './feedback.controller';
import { FeedbackResolver } from './feedback.resolver';
import { AuditModule } from '@common/audit/audit.module';

@Module({
  imports: [DatabaseModule, AuditModule],
  providers: [FeedbackService, FeedbackRepository, FeedbackResolver],
  controllers: [FeedbackController],
})
export class FeedbackModule {}
