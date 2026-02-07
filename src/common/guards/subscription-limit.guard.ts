// src/common/guards/subscription-limit.guard.ts
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
    const user = request.user; // Provided by JwtAuthGuard

    // 🛡️ Guard against public sessions attempting to access tenant-limited resources
    if (!user || !user.tenantId || user.schemaName === 'public') {
      throw new ForbiddenException('Tenant context required for this operation');
    }

    const { tenantId, schemaName } = user;

    // 1. Fetch the Limit from Public Schema using executePublic
    // We hit the global registry to find what this tenant is allowed to do
    const planResult = await this.tenantDb.executePublic(
      `
      SELECT p.${limitKey} as limit_value
      FROM public.subscriptions s
      JOIN public.subscription_plans p ON s.plan_id = p.id
      WHERE s.tenant_id = $1 AND s.status IN ('active', 'trial')
      LIMIT 1
    `,
      [tenantId],
    );

    if (!planResult.length) {
      throw new ForbiddenException('No active subscription found');
    }

    const limit = planResult[0].limit_value;

    // 2. Count current usage in the Tenant Schema using executeTenant
    // Note: 'max_users' are actually stored in public.users but scoped by tenant_id
    let currentCount: number;

    if (limitKey === 'max_users') {
      const usageResult = await this.tenantDb.executePublic(
        `SELECT COUNT(*) as count FROM public.users WHERE tenant_id = $1`,
        [tenantId],
      );
      currentCount = parseInt(usageResult[0].count);
    } else {
      // For items in the tenant's private schema (like invoices, products, etc.)
      const tableName = this.mapLimitKeyToTable(limitKey);
      const usageResult = await this.tenantDb.executeTenant(
        `SELECT COUNT(*) as count FROM "${tableName}"`,
        [tenantId], // executeTenant will handle the schema/search_path
      );
      currentCount = parseInt(usageResult[0].count);
    }

    if (currentCount >= limit) {
      throw new ForbiddenException(
        `Plan limit reached: ${currentCount}/${limit}. Please upgrade your plan.`,
      );
    }

    return true;
  }

  /**
   * Simple mapper for limit keys to table names
   */
  private mapLimitKeyToTable(key: string): string {
    const mapping: Record<string, string> = {
      max_invoices: 'invoices',
      max_projects: 'projects',
      // Add more mappings as your system grows
    };
    return mapping[key] || key.replace('max_', '');
  }
}
