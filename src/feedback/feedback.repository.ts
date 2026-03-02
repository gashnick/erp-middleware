import { Injectable } from '@nestjs/common';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { getUserId } from '@common/context/tenant-context';
import { Feedback, FeedbackRating } from './feedback.types';

@Injectable()
export class FeedbackRepository {
  private static readonly UPSERT_SQL = `
    INSERT INTO insight_feedback (user_id, insight_id, rating, comment)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, insight_id)
    DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment
    RETURNING id, user_id AS "userId", insight_id AS "insightId", rating, comment, created_at AS "createdAt"
  `;

  constructor(private readonly tenantDb: TenantQueryRunnerService) {}

  async save(insightId: string, rating: FeedbackRating, comment?: string): Promise<Feedback> {
    const userId = getUserId();

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
