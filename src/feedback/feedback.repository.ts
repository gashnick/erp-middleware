// src/feedback/feedback.repository.ts
//
// Responsibility: write feedback rows to insight_feedback.
//
// Table shape (tenant schema):
//   id, user_id, insight_id, rating, comment, created_at
//   UNIQUE (user_id, insight_id) — one rating per user per anomaly,
//   updatable via ON CONFLICT DO UPDATE so users can revise their rating.
//
// tenant_id is NOT a column — RLS schema_isolation policy enforces tenancy
// by checking current_schema(), so no explicit tenant_id is needed.

import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { getUserId } from '@common/context/tenant-context';
import { Feedback, FeedbackRating } from './feedback.types';

@Injectable()
export class FeedbackRepository {
  private static readonly UPSERT_SQL = `
    INSERT INTO insight_feedback (user_id, insight_id, rating, comment)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, insight_id)
    DO UPDATE SET
      rating   = EXCLUDED.rating,
      comment  = EXCLUDED.comment
    RETURNING
      id,
      user_id    AS "userId",
      insight_id AS "insightId",
      rating,
      comment,
      created_at AS "createdAt"
  `;

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  async save(insightId: string, rating: FeedbackRating, comment?: string): Promise<Feedback> {
    const userId = getUserId();
    // Fail fast with a clear message rather than a cryptic DB error
    if (!userId) throw new BadRequestException('User ID missing from context');
    if (!insightId) throw new BadRequestException('insightId is required');
    return this.tenantDb.transaction(async (runner) => {
      const rows = await runner.query(FeedbackRepository.UPSERT_SQL, [
        userId,
        insightId,
        rating,
        comment ?? null,
      ]);
      return rows[0];
    });
  }
}
