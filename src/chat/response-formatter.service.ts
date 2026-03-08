// src/chat/response-formatter.service.ts
//
// Responsibility: decide the best MessageContent shape for a given AI response.
//
// Decision priority:
//   0. LINK keywords + data    → LinkContent  (navigation intent)
//   1. EXPORT keywords + data  → CsvContent   (download intent)
//   2. CHART keywords + data   → ChartContent (Vega-Lite spec)
//   3. TABLE keywords + data   → TableContent (columns + rows)
//   4. Fallback                → TextContent  (plain LLM text)
//
// Chart and table structures are derived from the raw QueryResult[] that
// the dynamic query engine already fetched — no extra DB calls needed here.
//
// Vega-Lite schema: https://vega.github.io/schema/vega-lite/v5.json

import { Injectable } from '@nestjs/common';
import { MessageContent } from './chat.types';
import { QueryResult } from './dynamic-query/dynamic-query-builder.service';
import { QueryIntent } from './dynamic-query/table-registry';

// ── Keyword groups ─────────────────────────────────────────────────────────────

const LINK_KEYWORDS = [
  'link',
  'open',
  'view',
  'navigate',
  'go to',
  'show me the',
  'take me to',
  'dashboard',
  'anomaly panel',
  'insight',
];

const EXPORT_KEYWORDS = ['export', 'csv', 'download', 'spreadsheet', 'excel'];

const CHART_KEYWORDS = [
  'chart',
  'graph',
  'trend',
  'plot',
  'visualise',
  'visualize',
  'over time',
  'month by month',
  'show me a graph',
];

const TABLE_KEYWORDS = [
  'table',
  'list',
  'breakdown',
  'compare',
  'show me',
  'itemize',
  'detail',
  'details',
  'line by line',
];

// ── Intent → chart type mapping ────────────────────────────────────────────────

const CHART_TYPE_MAP: Partial<Record<QueryIntent, 'bar' | 'line' | 'arc'>> = {
  revenue_trend: 'line',
  expense_breakdown: 'bar',
  invoice_summary: 'arc',
  cash_position: 'bar',
  bank_transactions: 'bar',
  anomaly_summary: 'bar',
  product_inventory: 'bar',
};

@Injectable()
export class ResponseFormatterService {
  /**
   * Selects the best content format based on the user's question and available data.
   *
   * @param llmText      — sanitised AI response text
   * @param userQuestion — original user question (used for keyword detection)
   * @param queryResults — raw rows from the dynamic query engine (may be empty)
   */
  format(llmText: string, userQuestion: string, queryResults: QueryResult[] = []): MessageContent {
    const lower = userQuestion.toLowerCase();
    const hasData = queryResults.length > 0 && queryResults.some((r) => r.rowCount > 0);

    // Priority 0 — navigation/link request
    if (LINK_KEYWORDS.some((kw) => lower.includes(kw)) && hasData) {
      const link = this.buildLinkContent(queryResults, llmText);
      if (link) return link;
    }

    // Priority 1 — export/CSV request
    if (EXPORT_KEYWORDS.some((kw) => lower.includes(kw)) && hasData) {
      return this.buildCsvContent(queryResults);
    }

    // Priority 2 — chart/graph request
    if (CHART_KEYWORDS.some((kw) => lower.includes(kw)) && hasData) {
      const chart = this.buildChartContent(queryResults);
      if (chart) return chart;
    }

    // Priority 3 — table/list request
    if (TABLE_KEYWORDS.some((kw) => lower.includes(kw)) && hasData) {
      const table = this.buildTableContent(queryResults);
      if (table) return table;
    }

    // Fallback — plain text
    return { type: 'text', text: llmText };
  }

  // ── Link builder ──────────────────────────────────────────────────────────

  private buildLinkContent(queryResults: QueryResult[], _llmText: string): MessageContent | null {
    // Anomaly results → link to the insights dashboard panel
    const anomalyResult = queryResults.find(
      (r) => r.intent === 'anomaly_summary' && r.rowCount > 0,
    );
    if (anomalyResult) {
      const topAnomaly = anomalyResult.rows[0];
      const anomalyId = topAnomaly?.id as string | undefined;
      return {
        type: 'link',
        url: anomalyId ? `/dashboard/insights/${anomalyId}` : `/dashboard/insights`,
        label: 'View Anomaly in Dashboard',
      };
    }

    // Expense results → link to expense dashboard
    const expenseResult = queryResults.find(
      (r) => r.intent === 'expense_breakdown' && r.rowCount > 0,
    );
    if (expenseResult) {
      return {
        type: 'link',
        url: '/dashboard/expenses',
        label: 'View Expense Breakdown',
      };
    }

    // Invoice results → link to invoice dashboard
    const invoiceResult = queryResults.find(
      (r) => (r.intent === 'invoice_summary' || r.intent === 'overdue_invoices') && r.rowCount > 0,
    );
    if (invoiceResult) {
      return {
        type: 'link',
        url:
          invoiceResult.intent === 'overdue_invoices'
            ? '/dashboard/invoices?filter=overdue'
            : '/dashboard/invoices',
        label:
          invoiceResult.intent === 'overdue_invoices' ? 'View Overdue Invoices' : 'View Invoices',
      };
    }

    return null;
  }

  // ── Chart builder ─────────────────────────────────────────────────────────

  private buildChartContent(queryResults: QueryResult[]): MessageContent | null {
    const result =
      queryResults.find((r) => r.rowCount > 0 && CHART_TYPE_MAP[r.intent]) ??
      queryResults.find((r) => r.rowCount > 0);

    if (!result) return null;

    const mark = CHART_TYPE_MAP[result.intent] ?? 'bar';
    const { xField, yField, colorField } = this.inferChartFields(result);

    const spec: Record<string, unknown> = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      title: this.intentTitle(result.intent),
      mark,
      data: { values: result.rows },
      encoding: {
        x: { field: xField, type: mark === 'line' ? 'ordinal' : 'nominal', title: xField },
        y: {
          field: yField,
          type: 'quantitative',
          title: yField,
          axis: { format: '$,.0f' },
        },
        ...(colorField ? { color: { field: colorField, type: 'nominal' } } : {}),
        tooltip: [
          { field: xField, type: 'nominal' },
          { field: yField, type: 'quantitative', format: ',.2f' },
        ],
      },
      width: 'container',
      height: 300,
    };

    // revenue_trend — combine year + month into a readable label
    if (result.intent === 'revenue_trend') {
      spec.transform = [
        {
          calculate: "datum.year + '-' + (datum.month < 10 ? '0' + datum.month : datum.month)",
          as: 'period',
        },
      ];
      (spec.encoding as any).x = { field: 'period', type: 'ordinal', title: 'Month' };
    }

    return { type: 'chart', spec };
  }

  // ── Table builder ─────────────────────────────────────────────────────────

  private buildTableContent(queryResults: QueryResult[]): MessageContent | null {
    const result = queryResults.find((r) => r.rowCount > 0);
    if (!result) return null;

    const columns = Object.keys(result.rows[0]).map((k) =>
      k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    );

    const rows = result.rows.map((row) =>
      Object.values(row).map((v) => {
        if (typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)))) {
          return Number(v);
        }
        if (v instanceof Date) return v.toLocaleDateString();
        return v ?? '';
      }),
    );

    return { type: 'table', columns, rows };
  }

  // ── CSV builder ───────────────────────────────────────────────────────────

  private buildCsvContent(queryResults: QueryResult[]): MessageContent {
    const result = queryResults.find((r) => r.rowCount > 0);
    if (!result) return { type: 'csv', url: '', filename: 'export.csv' };

    const headers = Object.keys(result.rows[0]);
    const csvLines = [
      headers.join(','),
      ...result.rows.map((row) =>
        headers
          .map((h) => {
            const val = row[h] ?? '';
            const str = String(val);
            return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
          })
          .join(','),
      ),
    ];

    const csvContent = csvLines.join('\n');
    const dataUri = `data:text/csv;charset=utf-8,${encodeURIComponent(csvContent)}`;

    return {
      type: 'csv',
      url: dataUri,
      filename: `${result.intent}_${new Date().toISOString().slice(0, 10)}.csv`,
    };
  }

  // ── Field inference ───────────────────────────────────────────────────────

  private inferChartFields(result: QueryResult): {
    xField: string;
    yField: string;
    colorField?: string;
  } {
    const FIELD_MAP: Partial<Record<QueryIntent, { x: string; y: string; color?: string }>> = {
      revenue_trend: { x: 'month', y: 'revenue', color: 'currency' },
      expense_breakdown: { x: 'category', y: 'total', color: 'currency' },
      invoice_summary: { x: 'status', y: 'total', color: 'currency' },
      cash_position: { x: 'currency', y: 'balance' },
      bank_transactions: { x: 'date', y: 'amount', color: 'type' },
      anomaly_summary: { x: 'anomaly_type', y: 'score' },
      product_inventory: { x: 'product_name', y: 'price' },
    };

    const mapping = FIELD_MAP[result.intent];
    if (mapping) {
      return { xField: mapping.x, yField: mapping.y, colorField: mapping.color };
    }

    const keys = Object.keys(result.rows[0] ?? {});
    return { xField: keys[0] ?? 'x', yField: keys[1] ?? 'y' };
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  private intentTitle(intent: QueryIntent): string {
    const titles: Partial<Record<QueryIntent, string>> = {
      revenue_trend: 'Monthly Revenue Trend',
      expense_breakdown: 'Expense Breakdown by Category',
      invoice_summary: 'Invoice Status Summary',
      cash_position: 'Current Cash Position',
      bank_transactions: 'Recent Bank Transactions',
      anomaly_summary: 'Detected Anomalies',
      product_inventory: 'Product Inventory',
      overdue_invoices: 'Overdue Invoices',
      contact_list: 'Contacts',
    };
    return titles[intent] ?? intent.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
