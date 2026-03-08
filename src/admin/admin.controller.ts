// src/admin/admin.controller.ts
//
// Admin endpoints for model version management and prompt template versioning.
//
// All endpoints require JWT + TenantGuard — operations are scoped to the
// authenticated tenant's schema (prompt_templates, model_configs).
//
// Routes:
//   GET    /api/admin/model-config/:provider        — active model for provider
//   GET    /api/admin/model-config/:provider/history — all configs for provider
//   PUT    /api/admin/model-config/:provider        — set new active model
//   POST   /api/admin/model-config/:provider/rollback — roll back to previous model
//
//   GET    /api/admin/prompt-templates/:name/versions — list all versions
//   POST   /api/admin/prompt-templates/:name/publish  — publish new version
//   POST   /api/admin/prompt-templates/:name/rollback — roll back to previous version

import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { ModelConfigService, LLMProvider } from '../chat/model-config.service';
import { PromptTemplateService } from '../chat/prompt-template.service';

const VALID_PROVIDERS: LLMProvider[] = ['openai', 'gemini'];

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly modelConfig: ModelConfigService,
    private readonly promptTemplate: PromptTemplateService,
  ) {}

  // ── Model config ───────────────────────────────────────────────────────────

  @Get('model-config/:provider')
  async getActiveModel(@Param('provider') provider: string) {
    this.assertValidProvider(provider);
    const modelName = await this.modelConfig.getActiveModel(provider as LLMProvider);
    return { provider, modelName };
  }

  @Get('model-config/:provider/history')
  async getModelHistory(@Param('provider') provider: string) {
    this.assertValidProvider(provider);
    return this.modelConfig.list(provider as LLMProvider);
  }

  @Put('model-config/:provider')
  @HttpCode(HttpStatus.OK)
  async setActiveModel(
    @Param('provider') provider: string,
    @Body('modelName') modelName: string,
    @Body('notes') notes?: string,
  ) {
    this.assertValidProvider(provider);
    if (!modelName?.trim()) throw new BadRequestException('modelName is required');
    return this.modelConfig.setActiveModel(provider as LLMProvider, modelName.trim(), notes);
  }

  @Post('model-config/:provider/rollback')
  @HttpCode(HttpStatus.OK)
  async rollbackModel(@Param('provider') provider: string) {
    this.assertValidProvider(provider);
    return this.modelConfig.rollback(provider as LLMProvider);
  }

  // ── Prompt templates ───────────────────────────────────────────────────────

  @Get('prompt-templates/:name/versions')
  async listVersions(@Param('name') name: string) {
    return this.promptTemplate.listVersions(name);
  }

  @Post('prompt-templates/:name/publish')
  @HttpCode(HttpStatus.CREATED)
  async publishTemplate(@Param('name') name: string, @Body('content') content: string) {
    if (!content?.trim()) throw new BadRequestException('content is required');
    return this.promptTemplate.publish(name, content.trim());
  }

  @Post('prompt-templates/:name/rollback')
  @HttpCode(HttpStatus.OK)
  async rollbackTemplate(@Param('name') name: string) {
    return this.promptTemplate.rollback(name);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private assertValidProvider(provider: string): void {
    if (!VALID_PROVIDERS.includes(provider as LLMProvider)) {
      throw new BadRequestException(
        `Invalid provider '${provider}'. Must be one of: ${VALID_PROVIDERS.join(', ')}`,
      );
    }
  }
}
