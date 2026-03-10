// src/subscriptions/subscription.service.ts
//
// Manages subscription lifecycle — upgrade, downgrade, usage summary, seats.
//
// All plan changes:
//   1. Update the subscriptions row (plan_id, status)
//   2. Update tenants.max_seats to match new plan
//   3. Invalidate Redis feature flag cache so next request reads new limits
//
// Downgrade safety:
//   If the tenant currently has more active seats than the new plan allows,
//   downgrade is blocked with a clear error message listing how many seats
//   need to be deactivated first.

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { FeatureFlagService, UsageSummary } from './feature-flag.service';

export interface SubscriptionDetails {
  tenantId: string;
  planName: string;
  planSlug: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
  maxSeats: number;
}

const PLAN_MAX_SEATS: Record<string, number> = {
  free: 2,
  basic: 5,
  standard: 15,
  enterprise: 999,
};

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  private static readonly GET_SUBSCRIPTION_SQL = `
    SELECT
      t.id              AS "tenantId",
      sp.name           AS "planName",
      sp.slug           AS "planSlug",
      s.status,
      s.current_period_start AS "currentPeriodStart",
      s.current_period_end   AS "currentPeriodEnd",
      s.trial_ends_at        AS "trialEndsAt",
      t.max_seats            AS "maxSeats"
    FROM public.tenants t
    JOIN public.subscriptions s       ON s.tenant_id = t.id
    JOIN public.subscription_plans sp ON s.plan_id   = sp.id
    WHERE t.id = $1
      AND s.status IN ('active', 'trial')
    ORDER BY s.created_at DESC
    LIMIT 1
  `;

  private static readonly GET_PLAN_SQL = `
    SELECT id, slug, name,
           price_monthly AS "priceMonthly",
           max_users     AS "maxUsers"
    FROM public.subscription_plans
    WHERE slug = $1 AND is_active = true
    LIMIT 1
  `;

  private static readonly PLAN_ORDER: Record<string, number> = {
    free: 0,
    basic: 1,
    standard: 2,
    enterprise: 3,
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns current subscription details for a tenant.
   */
  async getCurrent(tenantId: string): Promise<SubscriptionDetails> {
    const rows = await this.dataSource.query(SubscriptionService.GET_SUBSCRIPTION_SQL, [tenantId]);
    if (!rows[0]) throw new NotFoundException('No active subscription found');
    return rows[0];
  }

  /**
   * Returns usage summary for all features this period.
   */
  async getUsageSummary(tenantId: string): Promise<UsageSummary[]> {
    return this.featureFlags.getUsageSummary(tenantId);
  }

  /**
   * Returns seat count for a tenant.
   */
  async getSeatCount(tenantId: string) {
    return this.featureFlags.getSeatCount(tenantId);
  }

  /**
   * Upgrades a tenant to a higher plan.
   * Takes effect immediately — new feature limits apply on next request.
   */
  async upgrade(tenantId: string, newPlanSlug: string): Promise<SubscriptionDetails> {
    const current = await this.getCurrent(tenantId);
    const currentOrder = SubscriptionService.PLAN_ORDER[current.planSlug] ?? 0;
    const newOrder = SubscriptionService.PLAN_ORDER[newPlanSlug] ?? 0;

    if (newOrder <= currentOrder) {
      throw new BadRequestException(
        `Cannot upgrade to '${newPlanSlug}' — it is the same or lower than your current plan '${current.planSlug}'. Use downgrade instead.`,
      );
    }

    await this.changePlan(tenantId, newPlanSlug, 'active');
    this.logger.log(`Tenant ${tenantId} upgraded: ${current.planSlug} → ${newPlanSlug}`);
    return this.getCurrent(tenantId);
  }

  /**
   * Downgrades a tenant to a lower plan.
   * Blocked if active seat count exceeds new plan's max_seats.
   */
  async downgrade(tenantId: string, newPlanSlug: string): Promise<SubscriptionDetails> {
    const current = await this.getCurrent(tenantId);
    const currentOrder = SubscriptionService.PLAN_ORDER[current.planSlug] ?? 0;
    const newOrder = SubscriptionService.PLAN_ORDER[newPlanSlug] ?? 0;

    if (newOrder >= currentOrder) {
      throw new BadRequestException(
        `Cannot downgrade to '${newPlanSlug}' — it is the same or higher than your current plan '${current.planSlug}'. Use upgrade instead.`,
      );
    }

    // Check seat count against new plan limit
    const newMaxSeats = PLAN_MAX_SEATS[newPlanSlug] ?? 5;
    const { used: activeSeats } = await this.featureFlags.getSeatCount(tenantId);

    if (activeSeats > newMaxSeats) {
      throw new ForbiddenException(
        `Cannot downgrade to '${newPlanSlug}' — you have ${activeSeats} active seats but the ${newPlanSlug} plan allows only ${newMaxSeats}. ` +
          `Please deactivate ${activeSeats - newMaxSeats} seat(s) before downgrading.`,
      );
    }

    await this.changePlan(tenantId, newPlanSlug, 'active');
    this.logger.log(`Tenant ${tenantId} downgraded: ${current.planSlug} → ${newPlanSlug}`);
    return this.getCurrent(tenantId);
  }

  /**
   * Deactivates a user seat.
   * The user still exists but no longer counts against the seat limit.
   */
  async deactivateSeat(tenantId: string, targetUserId: string): Promise<void> {
    const rows = await this.dataSource.query(
      `UPDATE public.users
       SET seat_active = false, updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id`,
      [targetUserId, tenantId],
    );

    if (!rows[0]) {
      throw new NotFoundException(`User ${targetUserId} not found in this tenant`);
    }

    this.logger.log(`Seat deactivated: user ${targetUserId} in tenant ${tenantId}`);
  }

  /**
   * Reactivates a previously deactivated user seat.
   * Blocked if tenant is at seat limit.
   */
  async activateSeat(tenantId: string, targetUserId: string): Promise<void> {
    const { used, max } = await this.featureFlags.getSeatCount(tenantId);
    if (used >= max) {
      throw new ForbiddenException(
        `Seat limit reached (${used}/${max}). Upgrade your plan or deactivate another seat first.`,
      );
    }

    const rows = await this.dataSource.query(
      `UPDATE public.users
       SET seat_active = true, updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id`,
      [targetUserId, tenantId],
    );

    if (!rows[0]) {
      throw new NotFoundException(`User ${targetUserId} not found in this tenant`);
    }
  }

  /**
   * Lists all users with their seat status for a tenant.
   */
  async listSeats(tenantId: string) {
    return this.dataSource.query(
      `SELECT
         id,
         full_name  AS "fullName",
         email,
         role,
         status,
         seat_active AS "seatActive",
         last_login_at AS "lastLoginAt",
         created_at    AS "createdAt"
       FROM public.users
       WHERE tenant_id = $1
         AND deleted_at IS NULL
       ORDER BY seat_active DESC, full_name ASC`,
      [tenantId],
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async changePlan(
    tenantId: string,
    newPlanSlug: string,
    newStatus: string,
  ): Promise<void> {
    // Resolve new plan ID
    const plans = await this.dataSource.query(SubscriptionService.GET_PLAN_SQL, [newPlanSlug]);
    if (!plans[0]) throw new NotFoundException(`Plan '${newPlanSlug}' not found`);
    const newPlanId = plans[0].id;
    const newMaxSeats = PLAN_MAX_SEATS[newPlanSlug] ?? 5;

    await this.dataSource.transaction(async (manager) => {
      // Update subscription
      await manager.query(
        `UPDATE public.subscriptions
         SET plan_id    = $1,
             status     = $2,
             updated_at = now()
         WHERE tenant_id = $3`,
        [newPlanId, newStatus, tenantId],
      );

      // Update max_seats on tenant
      await manager.query(
        `UPDATE public.tenants
         SET max_seats  = $1,
             updated_at = now()
         WHERE id = $2`,
        [newMaxSeats, tenantId],
      );
    });

    // Invalidate cache so new limits take effect immediately
    await this.featureFlags.invalidateCache(tenantId);
  }
}
