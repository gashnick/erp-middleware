// src/reports/report-generator.service.ts
//
// Assembles report data from Finance, HR, and Ops dashboard services,
// then renders it into the requested format (PDF, CSV, XLSX).
//
// PDF:  Puppeteer renders an HTML template to PDF bytes
// CSV:  Flat key-value summary exported as CSV text
// XLSX: Multi-sheet workbook via exceljs
//
// This service has NO knowledge of schedules, emails, or tokens.
// It just takes a ReportData payload and returns a Buffer.
// Single responsibility: data assembly + file generation only.

import { Injectable, Logger } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { HrDashboardService } from '@hr/hr-dashboard.service';
import { OpsDashboardService } from '@ops/ops-dashboard.service';
import {
  ReportData,
  ReportFormat,
  ReportSection,
  FinanceSection,
  HrSection,
  OpsSection,
} from './reports.types';

@Injectable()
export class ReportGeneratorService {
  private readonly logger = new Logger(ReportGeneratorService.name);

  // ── Finance SQL (no FinanceService exists yet — query directly) ───────────

  private static readonly CASH_BALANCE_SQL = `
    SELECT COALESCE(
      SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0
    )::decimal AS balance
    FROM bank_transactions
  `;

  private static readonly REVENUE_SQL = `
    SELECT COALESCE(SUM(amount), 0)::decimal AS total
    FROM invoices
    WHERE status = 'paid'
      AND invoice_date >= NOW() - INTERVAL '30 days'
  `;

  private static readonly EXPENSES_SQL = `
    SELECT COALESCE(SUM(amount), 0)::decimal AS total
    FROM expenses
    WHERE expense_date >= NOW() - INTERVAL '30 days'
  `;

  private static readonly OVERDUE_SQL = `
    SELECT COUNT(*)::int AS count FROM invoices WHERE status = 'overdue'
  `;

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly hrService: HrDashboardService,
    private readonly opsService: OpsDashboardService,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Assembles report data from requested sections.
   * Each section is fetched in parallel. A failing section is logged
   * and omitted rather than crashing the entire report.
   */
  async assembleReportData(
    tenantId: string,
    sections: ReportSection[],
    reportName: string,
  ): Promise<ReportData> {
    const now = new Date();
    const periodLabel = this.buildPeriodLabel(now);

    const [finance, hr, ops] = await Promise.all([
      sections.includes('finance')
        ? this.fetchFinance().catch((e) => {
            this.logger.error(`Finance section failed: ${e.message}`);
            return undefined;
          })
        : Promise.resolve(undefined),
      sections.includes('hr')
        ? this.fetchHr().catch((e) => {
            this.logger.error(`HR section failed: ${e.message}`);
            return undefined;
          })
        : Promise.resolve(undefined),
      sections.includes('ops')
        ? this.fetchOps().catch((e) => {
            this.logger.error(`Ops section failed: ${e.message}`);
            return undefined;
          })
        : Promise.resolve(undefined),
    ]);

    return {
      tenantId,
      reportName,
      generatedAt: now.toISOString(),
      periodLabel,
      sections,
      finance,
      hr,
      ops,
    };
  }

  /**
   * Renders report data into the requested format and returns a Buffer.
   */
  async render(data: ReportData, format: ReportFormat): Promise<Buffer> {
    switch (format) {
      case 'pdf':
        return this.renderPdf(data);
      case 'csv':
        return this.renderCsv(data);
      case 'xlsx':
        return this.renderXlsx(data);
    }
  }

  // ── Section fetchers ───────────────────────────────────────────────────────

  private async fetchFinance(): Promise<FinanceSection> {
    const [balanceRows, revenueRows, expenseRows, overdueRows] = await Promise.all([
      this.tenantDb.executeTenant<{ balance: string }>(ReportGeneratorService.CASH_BALANCE_SQL),
      this.tenantDb.executeTenant<{ total: string }>(ReportGeneratorService.REVENUE_SQL),
      this.tenantDb.executeTenant<{ total: string }>(ReportGeneratorService.EXPENSES_SQL),
      this.tenantDb.executeTenant<{ count: number }>(ReportGeneratorService.OVERDUE_SQL),
    ]);

    return {
      cashBalance: parseFloat(balanceRows[0]?.balance ?? '0'),
      totalRevenue: parseFloat(revenueRows[0]?.total ?? '0'),
      totalExpenses: parseFloat(expenseRows[0]?.total ?? '0'),
      overdueInvoices: Number(overdueRows[0]?.count ?? 0),
      currency: 'USD',
    };
  }

  private async fetchHr(): Promise<HrSection> {
    const [headcount, attrition, payroll] = await Promise.all([
      this.hrService.headcount(),
      this.hrService.attrition(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        new Date().toISOString(),
      ),
      this.hrService.payrollSummary(),
    ]);

    return {
      totalEmployees: headcount.total,
      activeEmployees: headcount.active,
      onLeave: headcount.onLeave,
      attritionRate: attrition.rate,
      totalPayroll: payroll.total,
      currency: payroll.currency,
    };
  }

  private async fetchOps(): Promise<OpsSection> {
    const [inventory, slaBreaches, pipeline] = await Promise.all([
      this.opsService.inventorySummary(),
      this.opsService.slaBreaches(),
      this.opsService.ordersPipeline(),
    ]);

    return {
      totalAssets: inventory.total,
      operationalAssets: inventory.operational,
      offlineAssets: inventory.offline,
      slaBreaches: slaBreaches.length,
      totalOrders: pipeline.totalOrders,
      ordersValue: pipeline.totalValue,
    };
  }

  // ── Renderers ──────────────────────────────────────────────────────────────

  private async renderPdf(data: ReportData): Promise<Buffer> {
    // Dynamic import — puppeteer is optional dep, fails gracefully if missing
    let puppeteer: any;
    try {
      puppeteer = require('puppeteer');
    } catch {
      throw new Error('puppeteer is not installed. Run: npm install puppeteer');
    }

    const html = this.buildHtml(data);
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }

  private renderCsv(data: ReportData): Buffer {
    const rows: string[] = [
      `"Report","${data.reportName}"`,
      `"Generated At","${data.generatedAt}"`,
      `"Period","${data.periodLabel}"`,
      `"Sections","${data.sections.join(', ')}"`,
      `""`,
    ];

    if (data.finance) {
      rows.push('"--- FINANCE ---"');
      rows.push(
        `"Cash Balance","${data.finance.cashBalance}"${data.finance.currency ? `,${data.finance.currency}` : ''}`,
      );
      rows.push(`"Revenue (30d)","${data.finance.totalRevenue}"`);
      rows.push(`"Expenses (30d)","${data.finance.totalExpenses}"`);
      rows.push(`"Overdue Invoices","${data.finance.overdueInvoices}"`);
      rows.push('""');
    }

    if (data.hr) {
      rows.push('"--- HR ---"');
      rows.push(`"Total Employees","${data.hr.totalEmployees}"`);
      rows.push(`"Active","${data.hr.activeEmployees}"`);
      rows.push(`"On Leave","${data.hr.onLeave}"`);
      rows.push(`"Attrition Rate (30d)","${data.hr.attritionRate}%"`);
      rows.push(`"Total Payroll","${data.hr.totalPayroll}"`);
      rows.push('""');
    }

    if (data.ops) {
      rows.push('"--- OPERATIONS ---"');
      rows.push(`"Total Assets","${data.ops.totalAssets}"`);
      rows.push(`"Operational","${data.ops.operationalAssets}"`);
      rows.push(`"Offline","${data.ops.offlineAssets}"`);
      rows.push(`"SLA Breaches","${data.ops.slaBreaches}"`);
      rows.push(`"Total Orders","${data.ops.totalOrders}"`);
      rows.push(`"Orders Value","${data.ops.ordersValue}"`);
    }

    return Buffer.from(rows.join('\n'), 'utf-8');
  }

  private async renderXlsx(data: ReportData): Promise<Buffer> {
    let ExcelJS: any;
    try {
      ExcelJS = require('exceljs');
    } catch {
      throw new Error('exceljs is not installed. Run: npm install exceljs');
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CID ERP';
    workbook.created = new Date();

    // ── Summary sheet ────────────────────────────────────────────────────────
    const summary = workbook.addWorksheet('Summary');
    summary.columns = [
      { header: 'Field', key: 'field', width: 30 },
      { header: 'Value', key: 'value', width: 40 },
    ];
    summary.addRow({ field: 'Report Name', value: data.reportName });
    summary.addRow({ field: 'Generated At', value: data.generatedAt });
    summary.addRow({ field: 'Period', value: data.periodLabel });
    summary.addRow({ field: 'Sections', value: data.sections.join(', ') });

    // Style header row
    summary.getRow(1).font = { bold: true };

    // ── Finance sheet ────────────────────────────────────────────────────────
    if (data.finance) {
      const ws = workbook.addWorksheet('Finance');
      ws.columns = [
        { header: 'Metric', key: 'metric', width: 30 },
        { header: 'Value', key: 'value', width: 20 },
        { header: 'Currency', key: 'currency', width: 12 },
      ];
      ws.getRow(1).font = { bold: true };
      ws.addRow({
        metric: 'Cash Balance',
        value: data.finance.cashBalance,
        currency: data.finance.currency,
      });
      ws.addRow({
        metric: 'Revenue (30d)',
        value: data.finance.totalRevenue,
        currency: data.finance.currency,
      });
      ws.addRow({
        metric: 'Expenses (30d)',
        value: data.finance.totalExpenses,
        currency: data.finance.currency,
      });
      ws.addRow({ metric: 'Overdue Invoices', value: data.finance.overdueInvoices, currency: '' });
    }

    // ── HR sheet ─────────────────────────────────────────────────────────────
    if (data.hr) {
      const ws = workbook.addWorksheet('HR');
      ws.columns = [
        { header: 'Metric', key: 'metric', width: 30 },
        { header: 'Value', key: 'value', width: 20 },
      ];
      ws.getRow(1).font = { bold: true };
      ws.addRow({ metric: 'Total Employees', value: data.hr.totalEmployees });
      ws.addRow({ metric: 'Active', value: data.hr.activeEmployees });
      ws.addRow({ metric: 'On Leave', value: data.hr.onLeave });
      ws.addRow({ metric: 'Attrition Rate (30d)', value: `${data.hr.attritionRate}%` });
      ws.addRow({ metric: 'Total Payroll', value: data.hr.totalPayroll });
    }

    // ── Ops sheet ─────────────────────────────────────────────────────────────
    if (data.ops) {
      const ws = workbook.addWorksheet('Operations');
      ws.columns = [
        { header: 'Metric', key: 'metric', width: 30 },
        { header: 'Value', key: 'value', width: 20 },
      ];
      ws.getRow(1).font = { bold: true };
      ws.addRow({ metric: 'Total Assets', value: data.ops.totalAssets });
      ws.addRow({ metric: 'Operational', value: data.ops.operationalAssets });
      ws.addRow({ metric: 'Offline', value: data.ops.offlineAssets });
      ws.addRow({ metric: 'SLA Breaches', value: data.ops.slaBreaches });
      ws.addRow({ metric: 'Total Orders', value: data.ops.totalOrders });
      ws.addRow({ metric: 'Orders Value', value: data.ops.ordersValue });
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  // ── HTML template for PDF ──────────────────────────────────────────────────

  private buildHtml(data: ReportData): string {
    const financeHtml = data.finance
      ? `
      <section>
        <h2>Finance</h2>
        <table>
          <tr><th>Cash Balance</th><td>${this.fmt(data.finance.cashBalance)} ${data.finance.currency}</td></tr>
          <tr><th>Revenue (30d)</th><td>${this.fmt(data.finance.totalRevenue)} ${data.finance.currency}</td></tr>
          <tr><th>Expenses (30d)</th><td>${this.fmt(data.finance.totalExpenses)} ${data.finance.currency}</td></tr>
          <tr><th>Overdue Invoices</th><td>${data.finance.overdueInvoices}</td></tr>
        </table>
      </section>`
      : '';

    const hrHtml = data.hr
      ? `
      <section>
        <h2>Human Resources</h2>
        <table>
          <tr><th>Total Employees</th><td>${data.hr.totalEmployees}</td></tr>
          <tr><th>Active</th><td>${data.hr.activeEmployees}</td></tr>
          <tr><th>On Leave</th><td>${data.hr.onLeave}</td></tr>
          <tr><th>Attrition Rate (30d)</th><td>${data.hr.attritionRate}%</td></tr>
          <tr><th>Total Payroll</th><td>${this.fmt(data.hr.totalPayroll)} ${data.hr.currency}</td></tr>
        </table>
      </section>`
      : '';

    const opsHtml = data.ops
      ? `
      <section>
        <h2>Operations</h2>
        <table>
          <tr><th>Total Assets</th><td>${data.ops.totalAssets}</td></tr>
          <tr><th>Operational</th><td>${data.ops.operationalAssets}</td></tr>
          <tr><th>Offline</th><td>${data.ops.offlineAssets}</td></tr>
          <tr><th>SLA Breaches</th><td>${data.ops.slaBreaches}</td></tr>
          <tr><th>Total Orders</th><td>${data.ops.totalOrders}</td></tr>
          <tr><th>Orders Value</th><td>${this.fmt(data.ops.ordersValue)}</td></tr>
        </table>
      </section>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; color: #1a1a2e; margin: 0; padding: 20px; }
    header { border-bottom: 3px solid #4f46e5; padding-bottom: 12px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 22px; color: #4f46e5; }
    .meta { font-size: 12px; color: #6b7280; margin-top: 4px; }
    h2 { font-size: 16px; color: #374151; border-left: 4px solid #4f46e5;
         padding-left: 10px; margin-top: 28px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
    th { text-align: left; background: #f3f4f6; padding: 8px 12px;
         width: 55%; color: #374151; font-weight: 600; }
    td { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
    section { margin-bottom: 20px; }
    footer { margin-top: 40px; font-size: 11px; color: #9ca3af;
             border-top: 1px solid #e5e7eb; padding-top: 10px; text-align: center; }
  </style>
</head>
<body>
  <header>
    <h1>${data.reportName}</h1>
    <div class="meta">Period: ${data.periodLabel} &nbsp;|&nbsp; Generated: ${new Date(data.generatedAt).toLocaleString()}</div>
  </header>
  ${financeHtml}
  ${hrHtml}
  ${opsHtml}
  <footer>Generated by CID ERP &mdash; Confidential</footer>
</body>
</html>`;
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  private buildPeriodLabel(now: Date): string {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    return `Week of ${start.toISOString().slice(0, 10)}`;
  }

  private fmt(n: number): string {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
