// src/chat/dynamic-query/dynamic-data-fetcher.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { QueryIntentService } from './query-intent.service';
import { DynamicQueryBuilderService, QueryResult } from './dynamic-query-builder.service';
import { ResultFormatterService } from './result-formatter.service';
import { AnalyticsCacheService } from '@analytics/analytics-cache.service';
import { QueryIntent } from './table-registry';

const DYNAMIC_TOKEN_BUDGET = 1_500;
const CHARS_PER_TOKEN = 4;

export interface DynamicFetchResult {
  formattedText: string;
  intentsUsed: QueryIntent[];
  tokenEstimate: number;
  usedDynamicQuery: boolean;
  // Raw query results — passed through for chart/table generation.
  // Empty array when snapshot fallback was used.
  queryResults: QueryResult[];
}

@Injectable()
export class DynamicDataFetcherService {
  private readonly logger = new Logger(DynamicDataFetcherService.name);

  constructor(
    private readonly intentService: QueryIntentService,
    private readonly queryBuilder: DynamicQueryBuilderService,
    private readonly formatter: ResultFormatterService,
    private readonly cache: AnalyticsCacheService,
  ) {}

  async fetchForQuestion(question: string): Promise<DynamicFetchResult> {
    if (this.intentService.isBroadOverview(question)) {
      this.logger.debug('Broad overview question — using KPI snapshot');
      return this.fallbackToSnapshot();
    }

    const intents = this.intentService.classify(question);

    if (intents.length === 0) {
      this.logger.debug('No intents classified — falling back to KPI snapshot');
      return this.fallbackToSnapshot();
    }

    this.logger.debug(`Fetching dynamic data for intents: [${intents.join(', ')}]`);

    const results = await this.queryBuilder.executeMany(intents);

    if (results.length === 0) {
      this.logger.warn('All dynamic queries failed — falling back to KPI snapshot');
      return this.fallbackToSnapshot();
    }

    const sections: string[] = [];
    const intentsUsed: QueryIntent[] = [];
    const queryResults: QueryResult[] = [];
    let tokenEstimate = 0;

    for (const result of results) {
      const section = this.formatter.format([result]);
      const sectionTokens = Math.ceil(section.length / CHARS_PER_TOKEN);

      if (tokenEstimate + sectionTokens > DYNAMIC_TOKEN_BUDGET) {
        this.logger.debug(
          `Token budget reached after ${intentsUsed.length} intents — dropping remaining`,
        );
        break;
      }

      sections.push(section);
      intentsUsed.push(result.intent);
      queryResults.push(result);
      tokenEstimate += sectionTokens;
    }

    return {
      formattedText: sections.join('\n\n'),
      intentsUsed,
      tokenEstimate,
      usedDynamicQuery: true,
      queryResults,
    };
  }

  private async fallbackToSnapshot(): Promise<DynamicFetchResult> {
    try {
      const snapshot = await this.cache.getSnapshot();
      const lines: string[] = [];

      lines.push(
        `Cash Position: ${snapshot.cashPosition.currency} ${Number(snapshot.cashPosition.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      );

      if (snapshot.revenueCurrentYear.length > 0) {
        lines.push('\nMonthly Revenue (paid invoices):');
        for (const r of snapshot.revenueCurrentYear) {
          const month = new Date(0, Number(r.month) - 1).toLocaleString('en-US', {
            month: 'short',
          });
          lines.push(
            `  ${month} ${r.year}: ${r.currency} ${Number(r.revenue).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          );
        }
      }

      if (snapshot.expenseBreakdownLast90Days.length > 0) {
        lines.push('\nExpense Breakdown (last 90 days):');
        for (const e of snapshot.expenseBreakdownLast90Days) {
          lines.push(
            `  ${e.category}: ${e.currency} ${Number(e.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          );
        }
      } else {
        lines.push('\nExpense Breakdown (last 90 days): No records found.');
      }

      const text = lines.join('\n');
      return {
        formattedText: text,
        intentsUsed: [],
        tokenEstimate: Math.ceil(text.length / CHARS_PER_TOKEN),
        usedDynamicQuery: false,
        queryResults: [],
      };
    } catch (err) {
      this.logger.error(`Snapshot fallback failed: ${err.message}`);
      return {
        formattedText: 'Financial data is temporarily unavailable.',
        intentsUsed: [],
        tokenEstimate: 10,
        usedDynamicQuery: false,
        queryResults: [],
      };
    }
  }
}
