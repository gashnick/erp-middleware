// src/chat/chat.service.ts
//
// Orchestrates the full chat pipeline:
//   guardrails → context build → prompt → LLM → output redaction → format → persist → audit

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuditLogService, AuditAction } from '@common/audit/audit-log.service';
import { ipFromRequest, uaFromRequest } from '@common/audit/audit.helpers';
import { getTenantContext } from '@common/context/tenant-context';
import { LLMClientFactory } from './llm/llm-client.factory';
import { ContextBuilderService } from './context-builder.service';
import { PromptTemplateService } from './prompt-template.service';
import { ResponseFormatterService } from './response-formatter.service';
import { PiiRedactorService } from './guardrails/pii-redactor.service';
import { ProfanityFilterService } from './guardrails/profanity-filter.service';
import { RateLimiterService } from './guardrails/rate-limiter.service';
import { ChatSessionRepository } from './chat-session.repository';
import { ChatMessage, ChatSession } from './chat.types';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly sessionRepo: ChatSessionRepository,
    private readonly llm: LLMClientFactory,
    private readonly contextSvc: ContextBuilderService,
    private readonly promptSvc: PromptTemplateService,
    private readonly formatter: ResponseFormatterService,
    private readonly redactor: PiiRedactorService,
    private readonly profanity: ProfanityFilterService,
    private readonly rateLimiter: RateLimiterService,
    private readonly audit: AuditLogService,
  ) {}

  async createSession(userId: string): Promise<ChatSession> {
    return this.sessionRepo.createSession(userId);
  }

  async getSession(sessionId: string): Promise<ChatSession> {
    return this.sessionRepo.getSession(sessionId);
  }

  async handleMessage(
    userId: string,
    sessionId: string,
    userText: string,
    req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  ): Promise<ChatMessage> {
    const start = Date.now();
    const ctx = getTenantContext();
    const tenantId = ctx?.tenantId || 'unknown';

    // ── Guardrails ────────────────────────────────────────────────────────────
    await this.rateLimiter.enforce();

    if (this.profanity.contains(userText)) {
      throw new BadRequestException('Message contains disallowed content.');
    }

    // ── Input redaction ───────────────────────────────────────────────────────
    const { redacted: safeInput } = await this.redactor.redact(userText, userId, sessionId, req);

    // ── Context build — carries both formatted text and raw QueryResult[] ─────
    const context = await this.contextSvc.build(userId, safeInput, sessionId, req);

    // ── Prompt ────────────────────────────────────────────────────────────────
    const template = await this.promptSvc.getActive('finance_chat');
    const systemPrompt = this.promptSvc.render(template, {
      kpiSummary: context.kpiSummary,
      anomalySummary: context.anomalySummary,
      entityGraph: context.entityGraph || 'No specific entities identified for this question.',
      tenantId,
    });

    // this.logger.debug(`SYSTEM PROMPT:\n${systemPrompt}`);
    // this.logger.debug(`USER INPUT: ${safeInput}`);

    // ── LLM call ──────────────────────────────────────────────────────────────
    const llmResp = await this.llm.complete({
      systemPrompt,
      messages: [{ role: 'user', text: safeInput }],
    });

    // ── Output redaction ──────────────────────────────────────────────────────
    const { redacted: safeOutput } = await this.redactor.redact(
      llmResp.text,
      userId,
      sessionId,
      req,
    );

    // ── Format — pass raw query results so formatter can build charts/tables ──
    const content = this.formatter.format(safeOutput, userText, context.queryResults);

    // ── Persist ───────────────────────────────────────────────────────────────
    const message = await this.sessionRepo.saveMessage({
      sessionId,
      role: 'assistant',
      content,
      latencyMs: Date.now() - start,
    });

    // ── Audit — fire-and-forget ───────────────────────────────────────────────
    void this.audit
      .log({
        tenantId,
        userId,
        action: AuditAction.READ,
        resourceType: 'chat_session',
        resourceId: sessionId,
        ipAddress: ipFromRequest(req),
        userAgent: uaFromRequest(req),
        metadata: {
          provider: llmResp.provider,
          model: llmResp.model,
          promptTemplate: template.name,
          latencyMs: message.latencyMs,
          contentType: content.type,
          intentsUsed: context.queryResults.map((r) => r.intent),
        },
      })
      .catch(() => {});

    return message;
  }
}
