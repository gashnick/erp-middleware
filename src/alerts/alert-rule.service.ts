// src/alerts/alert-rule.service.ts
//
// CRUD for alert rules. All operations are tenant-scoped via AsyncLocalStorage.
//
// Feature flag check:
//   Creating a rule checks the 'alert_rules' feature flag and increments usage.
//   This enforces per-plan limits (basic: 10 total, standard: 50, enterprise: unlimited).

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { FeatureFlagService } from '@subscription/feature-flag.service';
import { AlertRule, AlertRuleFilters, CreateAlertRuleDto, UpdateAlertRuleDto } from './alert.types';

@Injectable()
export class AlertRuleService {
  private readonly logger = new Logger(AlertRuleService.name);

  private static readonly INSERT_SQL = `
    INSERT INTO alert_rules (name, metric, operator, threshold, severity, channels, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING
      id, name, metric, operator, threshold, severity, channels,
      is_active AS "isActive", created_by AS "createdBy",
      created_at AS "createdAt", updated_at AS "updatedAt"
  `;

  private static readonly LIST_SQL = `
    SELECT
      id, name, metric, operator, threshold, severity, channels,
      is_active AS "isActive", created_by AS "createdBy",
      created_at AS "createdAt", updated_at AS "updatedAt"
    FROM alert_rules
    WHERE ($1::boolean IS NULL OR is_active = $1)
      AND ($2::text    IS NULL OR metric    = $2)
      AND ($3::text    IS NULL OR severity  = $3)
    ORDER BY created_at DESC
  `;

  private static readonly GET_BY_ID_SQL = `
    SELECT
      id, name, metric, operator, threshold, severity, channels,
      is_active AS "isActive", created_by AS "createdBy",
      created_at AS "createdAt", updated_at AS "updatedAt"
    FROM alert_rules
    WHERE id = $1
  `;

  private static readonly UPDATE_SQL = `
    UPDATE alert_rules SET
      name      = COALESCE($2, name),
      operator  = COALESCE($3, operator),
      threshold = COALESCE($4, threshold),
      severity  = COALESCE($5, severity),
      channels  = COALESCE($6, channels),
      is_active = COALESCE($7, is_active),
      updated_at = now()
    WHERE id = $1
    RETURNING
      id, name, metric, operator, threshold, severity, channels,
      is_active AS "isActive", created_by AS "createdBy",
      created_at AS "createdAt", updated_at AS "updatedAt"
  `;

  private static readonly DELETE_SQL = `
    DELETE FROM alert_rules WHERE id = $1 RETURNING id
  `;

  constructor(
    private readonly tenantDb: TenantQueryRunnerService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  async create(dto: CreateAlertRuleDto, userId: string, tenantId: string): Promise<AlertRule> {
    this.validateDto(dto);

    // Check feature flag and increment usage (throws 403 if limit reached)
    await this.featureFlags.checkAndIncrement(tenantId, 'alert_rules');

    const rows = await this.tenantDb.executeTenant<AlertRule>(AlertRuleService.INSERT_SQL, [
      dto.name,
      dto.metric,
      dto.operator,
      dto.threshold,
      dto.severity,
      dto.channels,
      userId,
    ]);

    this.logger.log(
      `Alert rule created: "${dto.name}" [${dto.metric} ${dto.operator} ${dto.threshold}]`,
    );
    return rows[0];
  }

  async list(filters: AlertRuleFilters = {}): Promise<AlertRule[]> {
    return this.tenantDb.executeTenant<AlertRule>(AlertRuleService.LIST_SQL, [
      filters.isActive ?? null,
      filters.metric ?? null,
      filters.severity ?? null,
    ]);
  }

  async findById(id: string): Promise<AlertRule> {
    const rows = await this.tenantDb.executeTenant<AlertRule>(AlertRuleService.GET_BY_ID_SQL, [id]);
    if (!rows[0]) throw new NotFoundException(`Alert rule ${id} not found`);
    return rows[0];
  }

  async update(id: string, dto: UpdateAlertRuleDto): Promise<AlertRule> {
    const rows = await this.tenantDb.executeTenant<AlertRule>(AlertRuleService.UPDATE_SQL, [
      id,
      dto.name ?? null,
      dto.operator ?? null,
      dto.threshold ?? null,
      dto.severity ?? null,
      dto.channels ?? null,
      dto.isActive ?? null,
    ]);
    if (!rows[0]) throw new NotFoundException(`Alert rule ${id} not found`);
    return rows[0];
  }

  async delete(id: string): Promise<void> {
    const rows = await this.tenantDb.executeTenant(AlertRuleService.DELETE_SQL, [id]);
    if (!rows[0]) throw new NotFoundException(`Alert rule ${id} not found`);
    this.logger.log(`Alert rule deleted: ${id}`);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private validateDto(dto: CreateAlertRuleDto): void {
    const validMetrics = [
      'cash_balance',
      'expense_spike',
      'overdue_invoice_count',
      'unusual_payment',
      'sla_breach',
    ];
    const validOps = ['lt', 'gt', 'lte', 'gte', 'eq'];
    const validSeverity = ['low', 'medium', 'high', 'critical'];
    const validChannels = ['email', 'whatsapp', 'in_app'];

    if (!validMetrics.includes(dto.metric))
      throw new BadRequestException(`Invalid metric: ${dto.metric}`);
    if (!validOps.includes(dto.operator))
      throw new BadRequestException(`Invalid operator: ${dto.operator}`);
    if (!validSeverity.includes(dto.severity))
      throw new BadRequestException(`Invalid severity: ${dto.severity}`);
    if (!dto.channels?.length) throw new BadRequestException('At least one channel is required');
    if (!dto.channels.every((c) => validChannels.includes(c)))
      throw new BadRequestException(`Invalid channel. Must be: ${validChannels.join(', ')}`);
    if (dto.threshold < 0) throw new BadRequestException('Threshold must be >= 0');
  }
}
