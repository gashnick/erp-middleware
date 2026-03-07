// src/chat/dynamic-query/result-formatter.service.ts
//
// Transforms raw QueryResult rows into LLM-readable text sections.
// Single responsibility: formatting only — no DB access, no business logic.
//
// Each intent has a dedicated formatter that produces a concise, clearly
// labelled text block. The LLM receives these blocks as part of the system
// prompt's KPI summary section.

import { Injectable } from '@nestjs/common';
import { QueryResult } from './dynamic-query-builder.service';
import { QueryIntent } from './table-registry';

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
export class ResultFormatterService {
  /**
   * Formats a list of QueryResults into a single text block for LLM injection.
   * Each result gets a clearly labelled section so the model knows the source.
   */
  format(results: QueryResult[]): string {
    if (results.length === 0) return 'No data available for the requested query.';

    return results
      .map((r) => this.formatOne(r))
      .filter(Boolean)
      .join('\n\n');
  }

  // ── Per-intent formatters ──────────────────────────────────────────────────

  private formatOne(result: QueryResult): string {
    if (result.rowCount === 0) {
      return `=== ${this.intentLabel(result.intent)} ===\nNo records found.`;
    }

    switch (result.intent) {
      case 'cash_position':
        return this.formatCashPosition(result);
      case 'revenue_trend':
        return this.formatRevenueTrend(result);
      case 'expense_breakdown':
        return this.formatExpenseBreakdown(result);
      case 'invoice_summary':
        return this.formatInvoiceSummary(result);
      case 'overdue_invoices':
        return this.formatOverdueInvoices(result);
      case 'bank_transactions':
        return this.formatBankTransactions(result);
      case 'product_inventory':
        return this.formatProductInventory(result);
      case 'anomaly_summary':
        return this.formatAnomalySummary(result);
      case 'contact_list':
        return this.formatContactList(result);
      default:
        return this.formatGeneric(result);
    }
  }

  private formatCashPosition(r: QueryResult): string {
    const lines = r.rows.map((row) => {
      const balance = this.money(row.balance);
      const currency = row.currency ?? 'USD';
      const asOf = row.as_of ? new Date(row.as_of as string).toLocaleDateString() : 'today';
      return `  ${currency}: ${balance} (as of ${asOf})`;
    });
    return `=== CASH POSITION ===\n${lines.join('\n')}`;
  }

  private formatRevenueTrend(r: QueryResult): string {
    const lines = r.rows.map((row) => {
      const month = MONTH_NAMES[Number(row.month)] ?? row.month;
      const year = row.year;
      const rev = this.money(row.revenue);
      return `  ${month} ${year}: ${row.currency} ${rev}`;
    });

    const total = r.rows.reduce((sum, row) => sum + Number(row.revenue ?? 0), 0);
    lines.push(`  ─────────────────────────────`);
    lines.push(`  Total: USD ${this.money(total)}`);

    return `=== REVENUE TREND (paid invoices, last 24 months) ===\n${lines.join('\n')}`;
  }

  private formatExpenseBreakdown(r: QueryResult): string {
    const lines = r.rows.map((row) => {
      const total = this.money(row.total);
      const avg = this.money(row.avg_amount);
      const count = row.count;
      return `  ${row.category}: ${row.currency} ${total} (${count} records, avg ${avg})`;
    });
    return `=== EXPENSE BREAKDOWN ===\n${lines.join('\n')}`;
  }

  private formatInvoiceSummary(r: QueryResult): string {
    const lines = r.rows.map((row) => {
      const total = this.money(row.total);
      return `  ${String(row.status).toUpperCase()} — ${row.count} invoices, ${row.currency} ${total}`;
    });
    return `=== INVOICE SUMMARY ===\n${lines.join('\n')}`;
  }

  private formatOverdueInvoices(r: QueryResult): string {
    const lines = r.rows.map((row) => {
      const amount = this.money(row.amount);
      const dueOn = row.due_on ? new Date(row.due_on as string).toLocaleDateString() : 'unknown';
      return `  Invoice ${row.invoice_id}: ${row.currency} ${amount} — due ${dueOn}`;
    });
    const totalOverdue = r.rows.reduce((s, row) => s + Number(row.amount ?? 0), 0);
    lines.push(`  Total overdue: USD ${this.money(totalOverdue)}`);
    return `=== OVERDUE INVOICES (${r.rowCount}) ===\n${lines.join('\n')}`;
  }

  private formatBankTransactions(r: QueryResult): string {
    const lines = r.rows.map((row) => {
      const date = row.date ? new Date(row.date as string).toLocaleDateString() : '';
      const amount = this.money(row.amount);
      const dir = row.type === 'credit' ? '↑' : '↓';
      const desc = row.description ? ` — ${row.description}` : '';
      return `  ${dir} ${row.currency} ${amount} on ${date}${desc}`;
    });
    return `=== RECENT BANK TRANSACTIONS (last 90 days) ===\n${lines.join('\n')}`;
  }

  private formatProductInventory(r: QueryResult): string {
    const lines = r.rows.map((row) => {
      const price = this.money(row.price);
      const stock = row.stock_level;
      const sku = row.sku ? ` [${row.sku}]` : '';
      return `  ${row.product_name}${sku}: $${price} | Stock: ${stock}`;
    });
    return `=== PRODUCT INVENTORY ===\n${lines.join('\n')}`;
  }

  private formatAnomalySummary(r: QueryResult): string {
    const lines = r.rows.map((row) => {
      const score = Number(row.score ?? 0).toFixed(2);
      const confidence = Number(row.confidence ?? 0).toFixed(2);
      const detectedAt = row.detected_at
        ? new Date(row.detected_at as string).toLocaleDateString()
        : '';
      return `  [${row.anomaly_type}] score=${score} confidence=${confidence} on ${detectedAt}: ${row.explanation}`;
    });
    return `=== ANOMALIES DETECTED ===\n${lines.join('\n')}`;
  }

  private formatContactList(r: QueryResult): string {
    // Group by type for readability
    const grouped: Record<string, string[]> = {};
    for (const row of r.rows) {
      const type = String(row.contact_type ?? 'other');
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(String(row.name));
    }
    const lines = Object.entries(grouped).map(
      ([type, names]) => `  ${type.toUpperCase()}: ${names.join(', ')}`,
    );
    return `=== CONTACTS (${r.rowCount}) ===\n${lines.join('\n')}`;
  }

  private formatGeneric(r: QueryResult): string {
    const label = this.intentLabel(r.intent);
    const lines = r.rows.slice(0, 10).map(
      (row) =>
        '  ' +
        Object.entries(row)
          .map(([k, v]) => `${k}: ${v}`)
          .join(' | '),
    );
    return `=== ${label} ===\n${lines.join('\n')}`;
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  private money(value: unknown): string {
    const n = Number(value ?? 0);
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private intentLabel(intent: QueryIntent): string {
    return intent.replace(/_/g, ' ').toUpperCase();
  }
}
