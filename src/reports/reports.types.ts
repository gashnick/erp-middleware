// src/reports/reports.types.ts
//
// Shared types for the Reports + Exports module (Stream 5).

// ── Enums ────────────────────────────────────────────────────────────────────

export type ReportFormat = 'pdf' | 'csv' | 'xlsx';
export type ReportSection = 'finance' | 'hr' | 'ops';

/** Simple interval values shown on the frontend picker */
export type SimpleInterval = 'daily' | 'weekly' | 'monthly';

// ── Report schedule ───────────────────────────────────────────────────────────

export interface ReportSchedule {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  format: ReportFormat;
  recipients: string[];
  sections: ReportSection[];
  isActive: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * DTO for creating a report schedule.
 *
 * Frontend sends either:
 *   A) { interval, hour, dayOfWeek?, dayOfMonth? }  ← simple picker
 *   B) { cron }                                      ← advanced toggle
 *
 * CronHelperService converts A → cron string before storage.
 * Only the cron string + timezone ever reach the DB.
 */
export interface CreateReportScheduleDto {
  name: string;
  format: ReportFormat;
  recipients: string[];
  sections?: ReportSection[];
  timezone?: string;

  // Simple interval (option A)
  interval?: SimpleInterval;
  hour?: number; // 0–23, default 8
  dayOfWeek?: number; // 0–6 (0=Sunday), used when interval=weekly
  dayOfMonth?: number; // 1–28, used when interval=monthly

  // Advanced cron (option B) — overrides interval fields if provided
  cron?: string;
}

export interface UpdateReportScheduleDto {
  name?: string;
  format?: ReportFormat;
  recipients?: string[];
  sections?: ReportSection[];
  timezone?: string;
  isActive?: boolean;
  interval?: SimpleInterval;
  hour?: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  cron?: string;
}

// ── Export log ────────────────────────────────────────────────────────────────

export interface ExportLog {
  id: string;
  secureToken: string;
  reportName: string;
  format: ReportFormat;
  fileSize: number | null;
  expiresAt: string;
  accessedAt: string | null;
  accessedByIp: string | null;
  createdBy: string;
  createdAt: string;
}

export interface CreateExportDto {
  reportName: string;
  format: ReportFormat;
  fileSize?: number;
  createdBy: string;
}

// ── Report data payload (assembled by ReportGeneratorService) ─────────────────

export interface FinanceSection {
  cashBalance: number;
  totalRevenue: number;
  totalExpenses: number;
  overdueInvoices: number;
  currency: string;
}

export interface HrSection {
  totalEmployees: number;
  activeEmployees: number;
  onLeave: number;
  attritionRate: number;
  totalPayroll: number;
  currency: string;
}

export interface OpsSection {
  totalAssets: number;
  operationalAssets: number;
  offlineAssets: number;
  slaBreaches: number;
  totalOrders: number;
  ordersValue: number;
}

export interface ReportData {
  tenantId: string;
  reportName: string;
  generatedAt: string;
  periodLabel: string; // e.g. "Week of 2026-03-24"
  sections: ReportSection[];
  finance?: FinanceSection;
  hr?: HrSection;
  ops?: OpsSection;
}
