// src/chat/context-builder.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { AnomalyService } from '../anomaly/anomaly.service';
import { PiiRedactorService } from './guardrails/pii-redactor.service';
import { DynamicDataFetcherService } from './dynamic-query/dynamic-data-fetcher.service';
import { GraphQueryService } from '../knowledgeGraph/graph-query.service';
import { ContextBundle } from './chat.types';
import { getTenantContext, runWithTenantContext } from '@common/context/tenant-context';

const MAX_TOKENS = 3_000;

@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);

  constructor(
    private readonly dynamicFetcher: DynamicDataFetcherService,
    private readonly anomaly: AnomalyService,
    private readonly redactor: PiiRedactorService,
    private readonly graphQuery: GraphQueryService,
  ) {}

  async build(
    userId: string,
    question: string,
    sessionId: string,
    req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  ): Promise<ContextBundle> {
    const ctx = getTenantContext();
    this.logger.debug(
      `Building context for schema: ${ctx.schemaName} | question: "${question.slice(0, 60)}"`,
    );

    const [fetchResult, recentAnomalies, relevantEntities] = await runWithTenantContext(
      {
        tenantId: ctx.tenantId!,
        schemaName: ctx.schemaName,
        userId: ctx.userId,
        userRole: ctx.userRole,
        userEmail: ctx.userEmail,
        requestId: ctx.requestId,
      },
      () =>
        Promise.all([
          this.dynamicFetcher.fetchForQuestion(question),
          this.anomaly.listAnomalies(undefined, 0.6),
          // KG entity search — non-fatal, returns [] if KG not yet populated
          this.graphQuery.findRelevantEntities(question).catch((err) => {
            this.logger.warn(`KG entity search failed (non-fatal): ${err.message}`);
            return [];
          }),
        ]),
    );

    this.logger.debug(
      `Dynamic fetch: intents=[${fetchResult.intentsUsed.join(', ')}] ` +
        `dynamic=${fetchResult.usedDynamicQuery} tokens~${fetchResult.tokenEstimate}`,
    );
    this.logger.debug(`Anomalies: ${recentAnomalies.length}`);
    this.logger.debug(`KG entities resolved: ${relevantEntities.length}`);

    // Anomaly summary
    const anomalySummary =
      recentAnomalies.length > 0
        ? recentAnomalies
            .slice(0, 5)
            .map((a) => `[${a.type}] score=${Number(a.score).toFixed(2)}: ${a.explanation}`)
            .join('\n')
        : 'No anomalies detected above threshold.';

    // Entity graph — relationship-aware text block for LLM grounding
    const entityGraph =
      relevantEntities.length > 0
        ? relevantEntities
            .map((e) => {
              const metaStr = Object.entries(e.meta ?? {})
                .filter(([, v]) => v !== null && v !== undefined)
                .map(
                  ([k, v]) =>
                    `${k}: ${typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: 2 }) : v}`,
                )
                .join(', ');
              return `${e.label} (${e.type})${metaStr ? ` — ${metaStr}` : ''}`;
            })
            .join('\n')
        : '';

    // PII redaction
    const { redacted: kpiSummary } = await this.redactor.redact(
      fetchResult.formattedText,
      userId,
      sessionId,
      req,
    );

    const tokenCount = Math.min(
      Math.ceil(`${kpiSummary}\n${anomalySummary}\n${entityGraph}`.length / 4),
      MAX_TOKENS,
    );

    return {
      kpiSummary,
      anomalySummary,
      entityGraph,
      entityRefs: relevantEntities.map((e) => e.id),
      tokenCount,
      queryResults: fetchResult.queryResults ?? [],
    };
  }
}
