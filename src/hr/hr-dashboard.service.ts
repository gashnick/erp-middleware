// src/hr/hr-dashboard.service.ts
//
// Provides HR analytics derived from the employees table.
// All queries use parameterized SQL — no interpolation.
//
// Attrition risk logic (rule-based, no ML):
//   - Tenure < 6 months AND status = active → "early tenure risk"
//   - No salary set → "compensation data missing"
//   These are flags for HR review, not predictions.

import { Injectable, Logger } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import {
  HeadcountSummary,
  HeadcountTrendPoint,
  AttritionSummary,
  AttritionRisk,
  PayrollSummary,
  Employee,
  EmployeeFilters,
  CreateEmployeeDto,
} from './hr.types';

@Injectable()
export class HrDashboardService {
  private readonly logger = new Logger(HrDashboardService.name);

  // ── SQL ───────────────────────────────────────────────────────────────────

  private static readonly HEADCOUNT_SUMMARY_SQL = `
    SELECT
      COUNT(*)                                          AS total,
      COUNT(*) FILTER (WHERE status = 'active')        AS active,
      COUNT(*) FILTER (WHERE status = 'on_leave')      AS "onLeave",
      COUNT(*) FILTER (WHERE status = 'terminated')    AS terminated
    FROM employees
    WHERE ($1::timestamp IS NULL OR start_date >= $1)
      AND ($2::timestamp IS NULL OR start_date <= $2)
  `;

  private static readonly HEADCOUNT_BY_DEPT_SQL = `
    SELECT
      department,
      COUNT(*)                                          AS total,
      COUNT(*) FILTER (WHERE status = 'active')        AS active,
      COUNT(*) FILTER (WHERE status = 'on_leave')      AS "onLeave",
      COUNT(*) FILTER (WHERE status = 'terminated')    AS terminated
    FROM employees
    WHERE ($1::varchar IS NULL OR department = $1)
    GROUP BY department
    ORDER BY total DESC
  `;

  private static readonly HEADCOUNT_TREND_SQL = `
    SELECT
      TO_CHAR(DATE_TRUNC('month', start_date), 'YYYY-MM') AS period,
      COUNT(*)                                              AS total,
      COUNT(*) FILTER (WHERE status = 'active')            AS active,
      COUNT(*) FILTER (WHERE status = 'terminated')        AS terminated
    FROM employees
    WHERE start_date >= NOW() - ($1 || ' months')::interval
    GROUP BY DATE_TRUNC('month', start_date)
    ORDER BY DATE_TRUNC('month', start_date) ASC
  `;

  private static readonly ATTRITION_SQL = `
    SELECT
      TO_CHAR(DATE_TRUNC('month', end_date), 'YYYY-MM') AS period,
      COUNT(*)                                            AS terminations
    FROM employees
    WHERE status = 'terminated'
      AND end_date >= $1
      AND end_date <= $2
    GROUP BY DATE_TRUNC('month', end_date)
    ORDER BY period DESC
    LIMIT 1
  `;

  private static readonly AVG_HEADCOUNT_SQL = `
    SELECT
      ROUND(
        (COUNT(*) FILTER (WHERE status IN ('active', 'on_leave', 'terminated'))
        )::numeric / NULLIF($1, 0),
        2
      ) AS avg_headcount
    FROM employees
    WHERE start_date <= $2
  `;

  private static readonly ATTRITION_RISK_SQL = `
    SELECT
      id          AS "employeeId",
      name,
      department,
      role,
      EXTRACT(MONTH FROM AGE(NOW(), start_date))::int AS "tenureMonths"
    FROM employees
    WHERE status = 'active'
      AND (
        EXTRACT(MONTH FROM AGE(NOW(), start_date)) < 6
        OR salary IS NULL
      )
    ORDER BY start_date DESC
    LIMIT 20
  `;

  private static readonly PAYROLL_SUMMARY_SQL = `
    SELECT
      COUNT(*)          AS headcount,
      SUM(salary)       AS total,
      AVG(salary)       AS "avgSalary",
      currency
    FROM employees
    WHERE status IN ('active', 'on_leave')
      AND salary IS NOT NULL
      AND ($1::varchar IS NULL OR department = $1)
    GROUP BY currency
    ORDER BY total DESC
    LIMIT 1
  `;

  private static readonly PAYROLL_BY_DEPT_SQL = `
    SELECT
      department,
      COUNT(*)          AS headcount,
      SUM(salary)       AS total,
      AVG(salary)       AS "avgSalary",
      currency
    FROM employees
    WHERE status IN ('active', 'on_leave')
      AND salary IS NOT NULL
    GROUP BY department, currency
    ORDER BY total DESC
  `;

  private static readonly LIST_EMPLOYEES_SQL = `
    SELECT
      id, external_id AS "externalId", name, department, role,
      status, start_date AS "startDate", end_date AS "endDate",
      salary, currency, metadata, created_at AS "createdAt"
    FROM employees
    WHERE ($1::varchar    IS NULL OR department = $1)
      AND ($2::varchar    IS NULL OR status     = $2)
      AND ($3::timestamp  IS NULL OR start_date >= $3)
      AND ($4::timestamp  IS NULL OR start_date <= $4)
    ORDER BY name ASC
    LIMIT  $5
    OFFSET $6
  `;

  private static readonly INSERT_EMPLOYEE_SQL = `
    INSERT INTO employees
      (external_id, name, department, role, status, start_date,
       end_date, salary, currency, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
    ON CONFLICT (external_id) WHERE external_id IS NOT NULL
    DO UPDATE SET
      name       = EXCLUDED.name,
      department = EXCLUDED.department,
      role       = EXCLUDED.role,
      status     = EXCLUDED.status,
      salary     = EXCLUDED.salary,
      end_date   = EXCLUDED.end_date
    RETURNING
      id, external_id AS "externalId", name, department, role,
      status, start_date AS "startDate", end_date AS "endDate",
      salary, currency, created_at AS "createdAt"
  `;

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  async headcount(filters: EmployeeFilters = {}): Promise<HeadcountSummary> {
    const [summaryRows, deptRows] = await Promise.all([
      this.tenantDb.executeTenant<any>(HrDashboardService.HEADCOUNT_SUMMARY_SQL, [
        filters.from ?? null,
        filters.to ?? null,
      ]),
      this.tenantDb.executeTenant<any>(HrDashboardService.HEADCOUNT_BY_DEPT_SQL, [
        filters.department ?? null,
      ]),
    ]);

    const s = summaryRows[0] ?? {};
    return {
      total: Number(s.total ?? 0),
      active: Number(s.active ?? 0),
      onLeave: Number(s.onLeave ?? 0),
      terminated: Number(s.terminated ?? 0),
      byDepartment: deptRows.map((r) => ({
        department: r.department,
        total: Number(r.total ?? 0),
        active: Number(r.active ?? 0),
        onLeave: Number(r.onLeave ?? 0),
        terminated: Number(r.terminated ?? 0),
      })),
    };
  }

  async headcountTrend(months = 12): Promise<HeadcountTrendPoint[]> {
    const rows = await this.tenantDb.executeTenant<any>(HrDashboardService.HEADCOUNT_TREND_SQL, [
      months,
    ]);
    return rows.map((r) => ({
      period: r.period,
      total: Number(r.total ?? 0),
      active: Number(r.active ?? 0),
      terminated: Number(r.terminated ?? 0),
    }));
  }

  async attrition(from: string, to: string): Promise<AttritionSummary> {
    const [attritionRows, riskRows] = await Promise.all([
      this.tenantDb.executeTenant<any>(HrDashboardService.ATTRITION_SQL, [from, to]),
      this.tenantDb.executeTenant<any>(HrDashboardService.ATTRITION_RISK_SQL),
    ]);

    const a = attritionRows[0] ?? {};
    const terminations = Number(a.terminations ?? 0);
    const period = a.period ?? to.slice(0, 7);

    // Simple avg: total employees / 1 period
    const avgRows = await this.tenantDb.executeTenant<any>(HrDashboardService.AVG_HEADCOUNT_SQL, [
      1,
      to,
    ]);
    const avgHeadcount = Number(avgRows[0]?.avg_headcount ?? 0);
    const rate = avgHeadcount > 0 ? Math.round((terminations / avgHeadcount) * 100 * 100) / 100 : 0;

    const riskFlags: AttritionRisk[] = riskRows.map((r) => ({
      employeeId: r.employeeId,
      name: r.name,
      department: r.department,
      role: r.role,
      tenureMonths: r.tenureMonths,
      riskReason: r.tenureMonths < 6 ? 'Early tenure (< 6 months)' : 'Missing compensation data',
    }));

    return { period, terminations, avgHeadcount, rate, riskFlags };
  }

  async payrollSummary(filters: EmployeeFilters = {}): Promise<PayrollSummary> {
    const [summaryRows, deptRows] = await Promise.all([
      this.tenantDb.executeTenant<any>(HrDashboardService.PAYROLL_SUMMARY_SQL, [
        filters.department ?? null,
      ]),
      this.tenantDb.executeTenant<any>(HrDashboardService.PAYROLL_BY_DEPT_SQL),
    ]);

    const s = summaryRows[0] ?? {};
    return {
      total: Number(s.total ?? 0),
      currency: s.currency ?? 'USD',
      headcount: Number(s.headcount ?? 0),
      avgSalary: Number(s.avgSalary ?? 0),
      byDepartment: deptRows.map((r) => ({
        department: r.department,
        headcount: Number(r.headcount ?? 0),
        total: Number(r.total ?? 0),
        currency: r.currency ?? 'USD',
        avgSalary: Number(r.avgSalary ?? 0),
      })),
    };
  }

  async listEmployees(filters: EmployeeFilters = {}, limit = 50, offset = 0): Promise<Employee[]> {
    return this.tenantDb.executeTenant<Employee>(HrDashboardService.LIST_EMPLOYEES_SQL, [
      filters.department ?? null,
      filters.status ?? null,
      filters.from ?? null,
      filters.to ?? null,
      limit,
      offset,
    ]);
  }

  async upsertEmployee(dto: CreateEmployeeDto): Promise<Employee> {
    const rows = await this.tenantDb.executeTenant<Employee>(
      HrDashboardService.INSERT_EMPLOYEE_SQL,
      [
        dto.externalId ?? null,
        dto.name,
        dto.department,
        dto.role,
        dto.status ?? 'active',
        dto.startDate,
        dto.endDate ?? null,
        dto.salary ?? null,
        dto.currency ?? 'USD',
        JSON.stringify(dto.metadata ?? {}),
      ],
    );
    return rows[0];
  }
}
