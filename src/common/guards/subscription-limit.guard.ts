import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';

@Injectable()
export class SubscriptionLimitGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private tenantDb: TenantQueryRunnerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limitKey = this.reflector.get<string>('planLimitKey', context.getHandler());
    if (!limitKey) return true; // No limit set on this route

    const request = context.switchToHttp().getRequest();
    const user = request.user; // Attached by JwtAuthGuard
    const tenantId = user.tenantId;
    const schemaName = user.schemaName; // Usually stored in JWT or looked up

    // 1. Fetch the Limit from Public Schema
    const planResult = await this.tenantDb.execute(
      `
      SELECT p.${limitKey} as limit_value
      FROM public.subscriptions s
      JOIN public.subscription_plans p ON s.plan_id = p.id
      WHERE s.tenant_id = $1 AND s.status IN ('active', 'trial')
    `,
      [tenantId],
    );

    if (!planResult.length) {
      throw new ForbiddenException('No active subscription found');
    }

    const limit = planResult[0].limit_value;

    // 2. Count current usage in the Tenant Schema
    // We map the limitKey to the specific table we need to count
    const tableName = limitKey === 'max_users' ? 'users' : 'invoices';
    const usageResult = await this.tenantDb.execute(
      `SELECT COUNT(*) as current_count FROM "${schemaName}"."${tableName}"`,
    );

    const currentCount = parseInt(usageResult[0].current_count);

    if (currentCount >= limit) {
      throw new ForbiddenException(
        `Plan limit reached: You have ${currentCount}/${limit} ${tableName}. Please upgrade your plan.`,
      );
    }

    return true;
  }
}
