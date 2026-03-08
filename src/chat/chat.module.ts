import { Module } from '@nestjs/common';
import { DatabaseModule } from '@database/database.module';
import { AnalyticsModule } from '@analytics/analytics.module';
import { AnomalyModule } from '../anomaly/anomaly.module';
import { KnowledgeGraphModule } from '../knowledgeGraph/knowledge-graph.module';
import { ChatService } from './chat.service';
import { ChatSessionRepository } from './chat-session.repository';
import { ChatController } from './chat.controller';
import { ChatResolver } from './chat.resolver';
import { LLMClientFactory } from './llm/llm-client.factory';
import { OpenAIClient } from './llm/openai.client';
import { GeminiClient } from './llm/gemini.client';
import { ContextBuilderService } from './context-builder.service';
import { ResponseFormatterService } from './response-formatter.service';
import { PromptTemplateService } from './prompt-template.service';
import { PiiRedactorService } from './guardrails/pii-redactor.service';
import { ProfanityFilterService } from './guardrails/profanity-filter.service';
import { RateLimiterService } from './guardrails/rate-limiter.service';
import { AuditModule } from '@common/audit/audit.module';
import { DynamicQueryModule } from './dynamic-query/dynamic-query.module';
import { ResponseValidatorService } from './guardrails/response-validator.service';

// DatabaseModule exports TenantQueryRunnerService — needed by RateLimiterService
// for tenant tier lookup and by ChatSessionRepository, PromptTemplateService.
@Module({
  imports: [
    DatabaseModule,
    AnalyticsModule,
    AnomalyModule,
    KnowledgeGraphModule,
    AuditModule,
    DynamicQueryModule,
  ],
  providers: [
    ChatService,
    ChatSessionRepository,
    ChatResolver,
    LLMClientFactory,
    OpenAIClient,
    GeminiClient,
    ContextBuilderService,
    ResponseFormatterService,
    PromptTemplateService,
    PiiRedactorService,
    ProfanityFilterService,
    RateLimiterService,
    ResponseValidatorService,
  ],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
