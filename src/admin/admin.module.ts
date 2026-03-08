// src/admin/admin.module.ts

import { Module } from '@nestjs/common';
import { DatabaseModule } from '@database/database.module';
import { AdminController } from './admin.controller';
import { ModelConfigService } from '../chat/model-config.service';
import { PromptTemplateService } from '../chat/prompt-template.service';
import { ChatModule } from '@chat/chat.module';

@Module({
  imports: [DatabaseModule, ChatModule],
  controllers: [AdminController],
  providers: [ModelConfigService, PromptTemplateService],
})
export class AdminModule {}
