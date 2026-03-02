import { Injectable, Logger } from '@nestjs/common';
import { AnalyticsCacheService } from '@analytics/analytics-cache.service';
import { AnomalyService } from '../anomaly/anomaly.service';
import { GraphQueryService } from '../knowledgeGraph/graph-query.service';
import { PiiRedactorService } from './guardrails/pii-redactor.service';
import { ContextBundle } from './chat.types';
import { getTenantContext, runWithTenantContext } from '@common/context/tenant-context';

const MAX_TOKENS = 3_000;

const MONTH_NAMES = [
  '',
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);

  constructor(
    private readonly cache: AnalyticsCacheService,
    private readonly anomaly: AnomalyService,
    private readonly graphQuery: GraphQueryService,
    private readonly redactor: PiiRedactorService,
  ) {}

  async build(
    userId: string,
    question: string,
    sessionId: string,
    req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  ): Promise<ContextBundle> {
    const ctx = getTenantContext();

    this.logger.debug(`Building context for tenant schema: ${ctx.schemaName}`);

    const [snapshot, recentAnomalies, entityRefs] = await runWithTenantContext(
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
          this.cache.getSnapshot(),
          this.anomaly.listAnomalies(undefined, 0.6),
          this.graphQuery.findRelevantEntities(question),
        ]),
    );

    this.logger.debug(`SNAPSHOT: ${JSON.stringify(snapshot)}`);
    this.logger.debug(`ANOMALIES: ${recentAnomalies.length}`);
    this.logger.debug(`ENTITIES: ${entityRefs.length}`);

    // ── Rich KPI summary ───────────────────────────────────────────────────

    const { cashPosition, revenueCurrentYear, expenseBreakdownLast90Days } = snapshot;
    const currentYear = new Date().getFullYear();

    // Cash position line
    const cashLine = `Cash Position: ${cashPosition.currency} ${Number(cashPosition.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    // Revenue — group by year, sorted chronologically
    const revenueByYear: Record<number, typeof revenueCurrentYear> = {};
    for (const r of revenueCurrentYear) {
      if (!revenueByYear[r.year]) revenueByYear[r.year] = [];
      revenueByYear[r.year].push(r);
    }

    const revenueLines: string[] = ['Monthly Revenue (paid invoices):'];
    for (const year of Object.keys(revenueByYear).map(Number).sort()) {
      const months = revenueByYear[year].sort((a, b) => a.month - b.month);
      for (const m of months) {
        const label = `${MONTH_NAMES[m.month]} ${m.year}`;
        const amt = Number(m.revenue).toLocaleString('en-US', { minimumFractionDigits: 2 });
        revenueLines.push(`  ${label}: ${m.currency} ${amt}`);
      }
    }

    const ytdTotal = revenueCurrentYear
      .filter((r) => r.year === currentYear)
      .reduce((sum, r) => sum + Number(r.revenue), 0);

    const prevYearTotal = revenueCurrentYear
      .filter((r) => r.year === currentYear - 1)
      .reduce((sum, r) => sum + Number(r.revenue), 0);

    if (ytdTotal > 0) {
      revenueLines.push(
        `YTD ${currentYear} Total: USD ${ytdTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      );
    }
    if (prevYearTotal > 0) {
      revenueLines.push(
        `Full Year ${currentYear - 1} Total: USD ${prevYearTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      );
    }

    // Expense breakdown
    const expenseLines: string[] = [];
    if (expenseBreakdownLast90Days.length > 0) {
      expenseLines.push('Expense Breakdown (last 90 days):');
      for (const e of expenseBreakdownLast90Days.slice(0, 10)) {
        const amt = Number(e.total).toLocaleString('en-US', { minimumFractionDigits: 2 });
        const vendor = e.vendorName ? ` (${e.vendorName})` : '';
        expenseLines.push(`  ${e.category}${vendor}: ${e.currency} ${amt}`);
      }
    } else {
      expenseLines.push(
        'Expense Breakdown (last 90 days): No expense records found in this period.',
      );
    }

    const rawKpi = [cashLine, '', revenueLines.join('\n'), '', expenseLines.join('\n')].join('\n');

    // ── Anomaly summary ────────────────────────────────────────────────────

    const anomalySummary =
      recentAnomalies.length > 0
        ? recentAnomalies
            .slice(0, 5)
            .map((a) => `[${a.type}] confidence=${a.score.toFixed(2)}: ${a.explanation}`)
            .join('\n')
        : 'No anomalies detected above threshold.';

    // ── PII redaction ──────────────────────────────────────────────────────

    const { redacted: kpiSummary } = await this.redactor.redact(rawKpi, userId, sessionId, req);

    const tokenCount = Math.ceil(`${kpiSummary}\n${anomalySummary}`.length / 4);

    return {
      kpiSummary,
      anomalySummary,
      entityRefs: entityRefs.map((e) => e.id),
      tokenCount: Math.min(tokenCount, MAX_TOKENS),
    };
  }
}
