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

  // 1. Removed tenantId param - sessionRepo pulls it from context
  async createSession(userId: string): Promise<ChatSession> {
    return this.sessionRepo.createSession(userId);
  }

  // 2. Removed tenantId param
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
    const ctx = getTenantContext(); // Grab context for auditing and logging
    const tenantId = ctx?.tenantId || 'unknown';

    // 3. Guardrails (tenantId removed - services use context)
    await this.rateLimiter.enforce();

    if (this.profanity.contains(userText)) {
      throw new BadRequestException('Message contains disallowed content.');
    }

    // 4. Redaction (tenantId removed)
    const { redacted: safeInput } = await this.redactor.redact(userText, userId, sessionId, req);

    // 5. Context Building (tenantId removed)
    const context = await this.contextSvc.build(userId, safeInput, sessionId, req);

    // 6. Prompting
    const template = await this.promptSvc.getActive('finance_chat');
    const systemPrompt = this.promptSvc.render(template, {
      kpiSummary: context.kpiSummary,
      anomalySummary: context.anomalySummary,
      tenantId, // Passed for rendering logic within the prompt text
    });

    this.logger.debug(`SYSTEM PROMPT:\n${systemPrompt}`);
    this.logger.debug(`USER INPUT: ${safeInput}`);
    // 7. LLM Call
    const llmResp = await this.llm.complete({
      systemPrompt,
      messages: [{ role: 'user', text: safeInput }],
    });

    // 8. Output Redaction
    const { redacted: safeOutput } = await this.redactor.redact(
      llmResp.text,
      userId,
      sessionId,
      req,
    );

    const content = this.formatter.format(safeOutput, userText);

    // 9. Persistence (tenantId removed from signature)
    const message = await this.sessionRepo.saveMessage({
      sessionId,
      role: 'assistant',
      content,
      latencyMs: Date.now() - start,
    });

    // 10. Audit
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
          PromptTemplateService: template.name,
          latencyMs: message.latencyMs,
        },
      })
      .catch(() => {});

    return message;
  }
}
