// src/anomaly/anomaly.repository.ts
//
// Responsibility: all DB reads/writes for the anomaly domain.
//
// Why schemaName is passed explicitly on scan methods:
//   Bull queue workers run in their own async execution context. AsyncLocalStorage
//   does NOT reliably propagate into Bull job handlers — hasTenantContext() returns
//   false inside transaction(), so it falls back to schema='public'.
//
//   Fix: pass schemaName via transaction({ schema }) directly. This bypasses
//   AsyncLocalStorage entirely and guarantees the correct search_path.
//
//   HTTP-request methods (list, findById) still use executeTenant() which reads
//   from AsyncLocalStorage normally — those calls always have a request context.

import { Injectable } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import {
  AnomalyCandidate,
  PersistedAnomaly,
  AnomalyType,
  DuplicateCandidate,
  PaymentRecord,
} from './anomaly.types';

@Injectable()
export class AnomalyRepository {
  // ── SQL constants ──────────────────────────────────────────────────────────

  private static readonly INSERT_SQL = `
    INSERT INTO anomalies
      (type, score, confidence, explanation, related_ids, detected_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT DO NOTHING
    RETURNING
      id,
      type,
      score,
      confidence,
      explanation,
      related_ids  AS "relatedIds",
      detected_at  AS "detectedAt"
  `;

  private static readonly LIST_SQL = `
    SELECT
      id,
      type,
      score,
      confidence,
      explanation,
      related_ids  AS "relatedIds",
      detected_at  AS "detectedAt"
    FROM anomalies
    WHERE ($1::text[]  IS NULL OR type  = ANY($1))
      AND ($2::numeric IS NULL OR score >= $2)
    ORDER BY detected_at DESC
    LIMIT  $3
    OFFSET $4
  `;

  private static readonly GET_BY_ID_SQL = `
    SELECT
      id,
      type,
      score,
      confidence,
      explanation,
      related_ids  AS "relatedIds",
      detected_at  AS "detectedAt"
    FROM anomalies
    WHERE id = $1
  `;

  private static readonly DUPLICATE_CANDIDATES_SQL = `
    SELECT
      fingerprint,
      array_agg(id::text ORDER BY id) AS "invoiceIds"
    FROM invoices
    WHERE fingerprint IS NOT NULL
    GROUP BY fingerprint
    HAVING COUNT(*) > 1
  `;

  private static readonly PAYMENT_RECORDS_SQL = `
    SELECT
      id::text                                  AS id,
      amount,
      EXTRACT(HOUR FROM transaction_date)::int  AS hour,
      EXTRACT(DOW  FROM transaction_date)::int  AS "dayOfWeek"
    FROM bank_transactions
    WHERE type = 'credit'
      AND transaction_date >= NOW() - INTERVAL '90 days'
    ORDER BY transaction_date DESC
  `;

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  // ── Scan methods — schemaName passed explicitly for Bull worker safety ─────

  async save(candidate: AnomalyCandidate, schemaName?: string): Promise<PersistedAnomaly | null> {
    return this.tenantDb.transaction(
      async (runner) => {
        const rows = await runner.query(AnomalyRepository.INSERT_SQL, [
          candidate.type,
          Math.round(Math.min(1, Math.max(0, candidate.score)) * 10_000) / 10_000,
          Math.round(Math.min(1, Math.max(0, candidate.confidence)) * 10_000) / 10_000,
          candidate.explanation,
          candidate.relatedIds,
          candidate.detectedAt,
        ]);
        return rows[0] ?? null;
      },
      schemaName ? { schema: schemaName } : undefined,
    );
  }

  async getDuplicateCandidates(schemaName?: string): Promise<DuplicateCandidate[]> {
    return this.tenantDb.transaction(
      async (runner) => runner.query(AnomalyRepository.DUPLICATE_CANDIDATES_SQL),
      schemaName ? { schema: schemaName } : undefined,
    );
  }

  async getPaymentRecords(schemaName?: string): Promise<PaymentRecord[]> {
    return this.tenantDb.transaction(
      async (runner) => runner.query(AnomalyRepository.PAYMENT_RECORDS_SQL),
      schemaName ? { schema: schemaName } : undefined,
    );
  }

  // ── HTTP-request methods — AsyncLocalStorage context available ─────────────

  async list(
    types?: AnomalyType[],
    minScore?: number,
    limit = 50,
    offset = 0,
  ): Promise<PersistedAnomaly[]> {
    return this.tenantDb.executeTenant<PersistedAnomaly>(AnomalyRepository.LIST_SQL, [
      types ?? null,
      minScore ?? null,
      limit,
      offset,
    ]);
  }

  async findById(id: string): Promise<PersistedAnomaly | null> {
    const rows = await this.tenantDb.executeTenant<PersistedAnomaly>(
      AnomalyRepository.GET_BY_ID_SQL,
      [id],
    );
    return rows[0] ?? null;
  }
}
