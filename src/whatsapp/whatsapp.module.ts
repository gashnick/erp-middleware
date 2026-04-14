// src/whatsapp/whatsapp.module.ts

import { Module } from '@nestjs/common';
import { DatabaseModule } from '@database/database.module';
import { ChatModule } from '@chat/chat.module';
import { ReportsModule } from '../reports/reports.module';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppTemplateService } from './whatsapp-template.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppResolver } from './whatsapp.resolver';
import { EncryptionModule } from '@common/security/encryption.module';

@Module({
  imports: [
    DatabaseModule, // TenantQueryRunnerService + EncryptionService
    ChatModule, // ChatService for LLM message routing
    ReportsModule, // ExportService for report download links (Stream 6 → Stream 5)
    EncryptionModule, // EncryptionService for encrypting/decrypting WhatsApp credentials
  ],
  providers: [WhatsAppService, WhatsAppTemplateService, WhatsAppResolver],
  controllers: [WhatsAppController],
  exports: [WhatsAppService], // AlertModule + ReportsModule import this
})
export class WhatsAppModule {}
