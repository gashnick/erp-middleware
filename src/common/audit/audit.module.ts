import { DatabaseModule } from '@database/database.module';
import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditLogService } from './audit-log.service';
@Module({
  imports: [DatabaseModule],
  controllers: [AuditController],
  providers: [AuditService, AuditLogService],
  exports: [AuditService, AuditLogService],
})
export class AuditModule {}
