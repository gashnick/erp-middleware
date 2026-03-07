// src/chat/context-builder.service.ts
//
// Builds the full context bundle injected into the LLM system prompt.
// Now also exposes raw queryResults on the bundle for chart/table generation.

import { Injectable, Logger } from '@nestjs/common';
import { AnomalyService } from '../anomaly/anomaly.service';
import { PiiRedactorService } from './guardrails/pii-redactor.service';
import { DynamicDataFetcherService } from './dynamic-query/dynamic-data-fetcher.service';
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

    const [fetchResult, recentAnomalies] = await runWithTenantContext(
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
        ]),
    );

    this.logger.debug(
      `Dynamic fetch: intents=[${fetchResult.intentsUsed.join(', ')}] ` +
        `dynamic=${fetchResult.usedDynamicQuery} tokens~${fetchResult.tokenEstimate}`,
    );
    this.logger.debug(`Anomalies: ${recentAnomalies.length}`);

    const anomalySummary =
      recentAnomalies.length > 0
        ? recentAnomalies
            .slice(0, 5)
            .map((a) => `[${a.type}] score=${Number(a.score).toFixed(2)}: ${a.explanation}`)
            .join('\n')
        : 'No anomalies detected above threshold.';

    const { redacted: kpiSummary } = await this.redactor.redact(
      fetchResult.formattedText,
      userId,
      sessionId,
      req,
    );

    const tokenCount = Math.min(
      Math.ceil(`${kpiSummary}\n${anomalySummary}`.length / 4),
      MAX_TOKENS,
    );

    return {
      kpiSummary,
      anomalySummary,
      entityRefs: [],
      tokenCount,
      // Pass raw query results through for ResponseFormatterService to build
      // charts and tables without additional DB calls
      queryResults: fetchResult.queryResults,
    };
  }
}
