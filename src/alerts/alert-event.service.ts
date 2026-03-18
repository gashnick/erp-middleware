// src/alerts/alert-event.service.ts
//
// Manages alert event lifecycle — list, acknowledge, resolve.
// Alert events are created by AlertEvaluatorService (never by this service).
// This service only handles the human-facing actions on existing events.

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { AlertEvent, AlertEventFilters } from './alert.types';

@Injectable()
export class AlertEventService {
  private readonly logger = new Logger(AlertEventService.name);

  private static readonly LIST_SQL = `
    SELECT
      ae.id,
      ae.rule_id        AS "ruleId",
      ae.metric,
      ae.actual_value   AS "actualValue",
      ae.threshold,
      ae.severity,
      ae.status,
      ae.acknowledged_by AS "acknowledgedBy",
      ae.acknowledged_at AS "acknowledgedAt",
      ae.resolved_at     AS "resolvedAt",
      ae.metadata,
      ae.triggered_at    AS "triggeredAt",
      json_build_object(
        'id',       ar.id,
        'name',     ar.name,
        'metric',   ar.metric,
        'severity', ar.severity,
        'channels', ar.channels
      ) AS rule
    FROM alert_events ae
    LEFT JOIN alert_rules ar ON ar.id = ae.rule_id
    WHERE ($1::text      IS NULL OR ae.status   = $1)
      AND ($2::text      IS NULL OR ae.severity = $2)
      AND ($3::timestamp IS NULL OR ae.triggered_at >= $3::timestamp)
      AND ($4::timestamp IS NULL OR ae.triggered_at <= $4::timestamp)
    ORDER BY ae.triggered_at DESC
    LIMIT  $5
    OFFSET $6
  `;

  private static readonly GET_BY_ID_SQL = `
    SELECT
      ae.id,
      ae.rule_id        AS "ruleId",
      ae.metric,
      ae.actual_value   AS "actualValue",
      ae.threshold,
      ae.severity,
      ae.status,
      ae.acknowledged_by AS "acknowledgedBy",
      ae.acknowledged_at AS "acknowledgedAt",
      ae.resolved_at     AS "resolvedAt",
      ae.metadata,
      ae.triggered_at    AS "triggeredAt"
    FROM alert_events ae
    WHERE ae.id = $1
  `;

  private static readonly ACKNOWLEDGE_SQL = `
    UPDATE alert_events SET
      status           = 'acknowledged',
      acknowledged_by  = $2,
      acknowledged_at  = now()
    WHERE id = $1 AND status = 'open'
    RETURNING id, status, acknowledged_by AS "acknowledgedBy", acknowledged_at AS "acknowledgedAt"
  `;

  private static readonly RESOLVE_SQL = `
    UPDATE alert_events SET
      status      = 'resolved',
      resolved_at = now()
    WHERE id = $1 AND status IN ('open', 'acknowledged')
    RETURNING id, status, resolved_at AS "resolvedAt"
  `;

  private static readonly OPEN_ALERTS_SQL = `
    SELECT
      ae.id,
      ae.rule_id       AS "ruleId",
      ae.metric,
      ae.actual_value  AS "actualValue",
      ae.threshold,
      ae.severity,
      ae.status,
      ae.metadata,
      ae.triggered_at  AS "triggeredAt"
    FROM alert_events ae
    WHERE ae.status = 'open'
    ORDER BY
      CASE ae.severity
        WHEN 'critical' THEN 1
        WHEN 'high'     THEN 2
        WHEN 'medium'   THEN 3
        WHEN 'low'      THEN 4
      END,
      ae.triggered_at DESC
  `;

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  async list(filters: AlertEventFilters = {}): Promise<AlertEvent[]> {
    return this.tenantDb.executeTenant<AlertEvent>(AlertEventService.LIST_SQL, [
      filters.status ?? null,
      filters.severity ?? null,
      filters.from ?? null,
      filters.to ?? null,
      filters.limit ?? 50,
      filters.offset ?? 0,
    ]);
  }

  async findById(id: string): Promise<AlertEvent> {
    const rows = await this.tenantDb.executeTenant<AlertEvent>(AlertEventService.GET_BY_ID_SQL, [
      id,
    ]);
    if (!rows[0]) throw new NotFoundException(`Alert event ${id} not found`);
    return rows[0];
  }

  async openAlerts(): Promise<AlertEvent[]> {
    return this.tenantDb.executeTenant<AlertEvent>(AlertEventService.OPEN_ALERTS_SQL);
  }

  async acknowledge(id: string, userId: string): Promise<AlertEvent> {
    const rows = await this.tenantDb.executeTenant<AlertEvent>(AlertEventService.ACKNOWLEDGE_SQL, [
      id,
      userId,
    ]);
    if (!rows[0]) throw new NotFoundException(`Alert event ${id} not found or not in 'open' state`);
    this.logger.log(`Alert event ${id} acknowledged by ${userId}`);
    return rows[0];
  }

  async resolve(id: string): Promise<AlertEvent> {
    const rows = await this.tenantDb.executeTenant<AlertEvent>(AlertEventService.RESOLVE_SQL, [id]);
    if (!rows[0]) throw new NotFoundException(`Alert event ${id} not found or already resolved`);
    this.logger.log(`Alert event ${id} resolved`);
    return rows[0];
  }
}
