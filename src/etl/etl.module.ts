import { Module } from '@nestjs/common';
import { EtlService } from './etl.service';
import { DatabaseModule } from '@database/database.module';
import { QuarantineController } from './quarantine.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [QuarantineController],
  providers: [EtlService],
  exports: [EtlService],
})
export class EtlModule {}
