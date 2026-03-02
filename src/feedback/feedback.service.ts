import { BadRequestException, Injectable } from '@nestjs/common';
import { FeedbackRepository } from './feedback.repository';
import { AuditLogService, AuditAction } from '@common/audit/audit-log.service';
import { ipFromRequest, uaFromRequest } from '@common/audit/audit.helpers';
import { Feedback, FeedbackRating } from './feedback.types';
import { getTenantContext } from '@common/context/tenant-context';

const VALID: FeedbackRating[] = ['helpful', 'not_helpful'];

@Injectable()
export class FeedbackService {
  constructor(
    private readonly repo: FeedbackRepository,
    private readonly audit: AuditLogService,
  ) {}

  async submit(
    insightId: string,
    rating: string,
    comment: string | undefined,
    req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  ): Promise<Feedback> {
    const ctx = getTenantContext();
    if (!ctx) throw new BadRequestException('Context missing');

    if (!VALID.includes(rating as FeedbackRating)) {
      throw new BadRequestException('rating must be "helpful" or "not_helpful".');
    }

    // tenantId and userId removed from signature
    // Repository pulls from AsyncLocalStorage via TenantQueryRunner
    const feedback = await this.repo.save(insightId, rating as FeedbackRating, comment);

    this.audit
      .log({
        // Service should pull these from context internally,
        // but we pass them here if your AuditLogService.log still requires them
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: AuditAction.WRITE,
        resourceType: 'insight_feedback',
        resourceId: insightId,
        ipAddress: ipFromRequest(req),
        userAgent: uaFromRequest(req),
        metadata: { rating, insightId },
      })
      .catch(() => {});

    return feedback;
  }
}
