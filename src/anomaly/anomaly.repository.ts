import { Injectable } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import {
  AnomalyCandidate,
  PersistedAnomaly,
  AnomalyType,
  DuplicateCandidate,
} from './anomaly.types';

@Injectable()
export class AnomalyRepository {
  // 1. Removed 'public.' and 'tenant_id' column
  private static readonly INSERT_SQL = `
    INSERT INTO anomalies
      (type, score, confidence, explanation, related_ids, detected_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING
      id,
      type, score, confidence, explanation,
      related_ids AS "relatedIds",
      detected_at AS "detectedAt"
  `;

  private static readonly LIST_SQL = `
    SELECT
      id, type, score, confidence, explanation,
      related_ids AS "relatedIds", detected_at AS "detectedAt"
    FROM anomalies
    WHERE ($1::text[]  IS NULL OR type  = ANY($1))
      AND ($2::numeric IS NULL OR score >= $2)
    ORDER BY detected_at DESC
    LIMIT  $3
    OFFSET $4
  `;

  private static readonly GET_BY_ID_SQL = `
    SELECT
      id, type, score, confidence, explanation,
      related_ids AS "relatedIds", detected_at AS "detectedAt"
    FROM anomalies
    WHERE id = $1
  `;

  private static readonly DUPLICATE_CANDIDATES_SQL = `
    SELECT fingerprint, array_agg(id ORDER BY id) AS "invoiceIds"
    FROM invoices
    WHERE fingerprint IS NOT NULL
    GROUP BY fingerprint
    HAVING COUNT(*) > 1
  `;

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  // Added helper for background jobs (used by AnomalyService.runScanForTenant)
  async runInTenantContext<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return this.tenantDb.transaction(() => work(), { schema: `tenant_${tenantId}` });
  }

  async save(candidate: AnomalyCandidate): Promise<PersistedAnomaly> {
    return this.tenantDb.transaction(async (runner) => {
      const rows = await runner.query(AnomalyRepository.INSERT_SQL, [
        candidate.type,
        candidate.score,
        candidate.confidence,
        candidate.explanation,
        candidate.relatedIds,
        candidate.detectedAt,
      ]);
      return rows[0];
    });
  }

  async list(
    types?: AnomalyType[],
    minScore?: number,
    limit = 50,
    offset = 0,
  ): Promise<PersistedAnomaly[]> {
    return this.tenantDb.transaction(async (runner) => {
      return runner.query(AnomalyRepository.LIST_SQL, [
        types ?? null,
        minScore ?? null,
        limit,
        offset,
      ]);
    });
  }

  async findById(id: string): Promise<PersistedAnomaly | null> {
    return this.tenantDb.transaction(async (runner) => {
      const rows = await runner.query(AnomalyRepository.GET_BY_ID_SQL, [id]);
      return rows[0] ?? null;
    });
  }

  async getDuplicateCandidates(): Promise<DuplicateCandidate[]> {
    return this.tenantDb.transaction(async (runner) => {
      return runner.query(AnomalyRepository.DUPLICATE_CANDIDATES_SQL);
    });
  }
}
