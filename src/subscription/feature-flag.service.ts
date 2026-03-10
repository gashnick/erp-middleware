// src/subscriptions/feature-flag.service.ts
//
// Single source of truth for feature access and usage tracking.
//
// Every service that needs to gate functionality by plan tier calls this
// service instead of querying subscription_plans directly or hardcoding limits.
//
// Resolution order for a feature check:
//   1. Redis cache (tenant_flags:{tenantId} — 5 minute TTL)
//   2. JOIN tenants → subscriptions → subscription_plans → feature_flags
//   3. Fallback to disabled + limit=0 on any DB error (fail safe)
//
// Usage tracking:
//   usage_records stores (tenant_id, feature, period='YYYY-MM', used=N)
//   checkAndIncrement() is the main entry point — checks limit then increments
//   atomically using INSERT ... ON CONFLICT DO UPDATE to avoid race conditions.

import { Injectable, Logger, ForbiddenException, Optional } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';

export interface FeatureFlag {
  feature: string;
  enabled: boolean;
  limitValue: number | null; // null = unlimited
  limitUnit: string | null; // 'per_month' | 'per_day' | 'total' | null
}

export interface UsageSummary {
  feature: string;
  enabled: boolean;
  used: number;
  limit: number | null;
  unit: string | null;
  percentUsed: number | null;
  remaining: number | null;
}

// Cache TTL in seconds — 5 minutes
const FLAG_CACHE_TTL = 300;
// Cache key prefix
const FLAG_CACHE_PREFIX = 'tenant_flags:';

@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);

  // ── SQL ───────────────────────────────────────────────────────────────────

  private static readonly GET_FLAGS_SQL = `
    SELECT
      ff.feature,
      ff.enabled,
      ff.limit_value  AS "limitValue",
      ff.limit_unit   AS "limitUnit"
    FROM public.feature_flags ff
    JOIN public.subscription_plans sp ON sp.slug = ff.plan_slug
    JOIN public.subscriptions s       ON s.plan_id = sp.id
    JOIN public.tenants t             ON t.id = s.tenant_id
    WHERE t.id = $1
      AND s.status IN ('active', 'trial')
    ORDER BY s.created_at DESC
  `;

  private static readonly GET_USAGE_SQL = `
    SELECT used
    FROM public.usage_records
    WHERE tenant_id = $1
      AND feature   = $2
      AND period    = $3
  `;

  private static readonly UPSERT_USAGE_SQL = `
    INSERT INTO public.usage_records (tenant_id, feature, used, period)
    VALUES ($1, $2, 1, $3)
    ON CONFLICT (tenant_id, feature, period)
    DO UPDATE SET
      used       = usage_records.used + 1,
      updated_at = now()
    RETURNING used
  `;

  private static readonly GET_PLAN_SLUG_SQL = `
    SELECT sp.slug, t.max_seats
    FROM public.tenants t
    JOIN public.subscriptions s       ON s.tenant_id = t.id
    JOIN public.subscription_plans sp ON s.plan_id   = sp.id
    WHERE t.id = $1
      AND s.status IN ('active', 'trial')
    ORDER BY s.created_at DESC
    LIMIT 1
  `;

  private static readonly GET_SEAT_COUNT_SQL = `
    SELECT
      COUNT(*) FILTER (WHERE seat_active = true)  AS used,
      t.max_seats                                  AS max
    FROM public.users u
    JOIN public.tenants t ON t.id = u.tenant_id
    WHERE u.tenant_id = $1
      AND u.deleted_at IS NULL
    GROUP BY t.max_seats
  `;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() @InjectRedis() private readonly redis: Redis,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns true if the feature is enabled for this tenant's plan.
   * Uses Redis cache — fast path for every request.
   */
  async isEnabled(tenantId: string, feature: string): Promise<boolean> {
    const flags = await this.getFlags(tenantId);
    const flag = flags.find((f) => f.feature === feature);
    return flag?.enabled ?? false;
  }

  /**
   * Returns remaining usage for a feature this period.
   * Returns null if the feature has no limit (unlimited).
   * Returns 0 if the limit is reached.
   */
  async getRemainingUsage(tenantId: string, feature: string): Promise<number | null> {
    const flags = await this.getFlags(tenantId);
    const flag = flags.find((f) => f.feature === feature);

    if (!flag?.enabled) return 0;
    if (flag.limitValue === null) return null; // unlimited

    const period = this.currentPeriod(flag.limitUnit);
    const used = await this.getUsed(tenantId, feature, period);
    return Math.max(0, flag.limitValue - used);
  }

  /**
   * Checks if the feature is allowed and increments usage atomically.
   * Throws ForbiddenException if:
   *   - Feature is not enabled for this plan
   *   - Usage limit is reached
   *
   * This is the main entry point for gating features.
   */
  async checkAndIncrement(tenantId: string, feature: string): Promise<void> {
    const flags = await this.getFlags(tenantId);
    const flag = flags.find((f) => f.feature === feature);

    // Feature not enabled for this plan
    if (!flag?.enabled) {
      const slug = await this.getPlanSlug(tenantId);
      throw new ForbiddenException(
        `Feature '${feature}' is not available on the ${slug} plan. Please upgrade to access this feature.`,
      );
    }

    // Unlimited — just increment for tracking, no limit check needed
    if (flag.limitValue === null) {
      const period = this.currentPeriod(flag.limitUnit);
      await this.increment(tenantId, feature, period);
      return;
    }

    // Check limit then increment atomically
    const period = this.currentPeriod(flag.limitUnit);
    const rows = await this.dataSource.query(FeatureFlagService.UPSERT_USAGE_SQL, [
      tenantId,
      feature,
      period,
    ]);

    const used = rows[0]?.used ?? 1;

    if (used > flag.limitValue) {
      // Decrement back since we already incremented
      await this.dataSource.query(
        `UPDATE public.usage_records
         SET used = used - 1, updated_at = now()
         WHERE tenant_id = $1 AND feature = $2 AND period = $3`,
        [tenantId, feature, period],
      );

      const slug = await this.getPlanSlug(tenantId);
      throw new ForbiddenException(
        `You have reached the ${feature} limit (${flag.limitValue} ${flag.limitUnit}) for your ${slug} plan. ` +
          `Please upgrade or wait until next period.`,
      );
    }
  }

  /**
   * Returns full usage summary for all features for a tenant.
   * Used by GET /api/subscription/usage.
   */
  async getUsageSummary(tenantId: string): Promise<UsageSummary[]> {
    const flags = await this.getFlags(tenantId);
    const period = this.currentPeriod('per_month'); // always monthly for summary

    const summaries: UsageSummary[] = [];

    for (const flag of flags) {
      const used =
        flag.limitValue !== null
          ? await this.getUsed(tenantId, flag.feature, period)
          : await this.getUsed(tenantId, flag.feature, period);

      const percentUsed =
        flag.limitValue !== null && flag.limitValue > 0
          ? Math.round((used / flag.limitValue) * 100)
          : null;

      const remaining = flag.limitValue !== null ? Math.max(0, flag.limitValue - used) : null;

      summaries.push({
        feature: flag.feature,
        enabled: flag.enabled,
        used,
        limit: flag.limitValue,
        unit: flag.limitUnit,
        percentUsed,
        remaining,
      });
    }

    return summaries;
  }

  /**
   * Returns seat count for a tenant.
   */
  async getSeatCount(tenantId: string): Promise<{ used: number; max: number }> {
    const rows = await this.dataSource.query(FeatureFlagService.GET_SEAT_COUNT_SQL, [tenantId]);
    return {
      used: Number(rows[0]?.used ?? 0),
      max: Number(rows[0]?.max ?? 5),
    };
  }

  /**
   * Returns the plan slug for a tenant.
   * Used in error messages.
   */
  async getPlanSlug(tenantId: string): Promise<string> {
    // Check Redis cache first
    const cacheKey = `tenant_tier:${tenantId}`;
    if (this.redis) {
      const cached = await this.redis.get(cacheKey).catch(() => null);
      if (cached) return cached;
    }

    const rows = await this.dataSource.query(FeatureFlagService.GET_PLAN_SLUG_SQL, [tenantId]);
    const slug = rows[0]?.slug ?? 'free';

    // Cache for 5 minutes
    if (this.redis) {
      await this.redis.setex(cacheKey, FLAG_CACHE_TTL, slug).catch(() => {});
    }

    return slug;
  }

  /**
   * Invalidates the Redis cache for a tenant.
   * Call after plan upgrade/downgrade.
   */
  async invalidateCache(tenantId: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.del(`${FLAG_CACHE_PREFIX}${tenantId}`).catch(() => {});
    await this.redis.del(`tenant_tier:${tenantId}`).catch(() => {});
    this.logger.debug(`Cache invalidated for tenant ${tenantId}`);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Fetches feature flags for a tenant — Redis cache first, DB fallback.
   */
  private async getFlags(tenantId: string): Promise<FeatureFlag[]> {
    const cacheKey = `${FLAG_CACHE_PREFIX}${tenantId}`;

    // Try Redis first
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached) as FeatureFlag[];
      } catch (err) {
        this.logger.warn(`Redis cache miss for flags (${err.message})`);
      }
    }

    // DB lookup
    try {
      const rows = await this.dataSource.query(FeatureFlagService.GET_FLAGS_SQL, [tenantId]);
      const flags = rows as FeatureFlag[];

      // Cache result
      if (this.redis && flags.length > 0) {
        await this.redis.setex(cacheKey, FLAG_CACHE_TTL, JSON.stringify(flags)).catch(() => {});
      }

      return flags;
    } catch (err) {
      this.logger.error(`Failed to load feature flags for tenant ${tenantId}: ${err.message}`);
      return []; // fail safe — all features appear disabled
    }
  }

  /**
   * Returns current usage count for a feature in a given period.
   */
  private async getUsed(tenantId: string, feature: string, period: string): Promise<number> {
    try {
      const rows = await this.dataSource.query(FeatureFlagService.GET_USAGE_SQL, [
        tenantId,
        feature,
        period,
      ]);
      return Number(rows[0]?.used ?? 0);
    } catch {
      return 0;
    }
  }

  /**
   * Increments usage without a limit check.
   * Used for unlimited features where we only track for analytics.
   */
  private async increment(tenantId: string, feature: string, period: string): Promise<void> {
    await this.dataSource
      .query(FeatureFlagService.UPSERT_USAGE_SQL, [tenantId, feature, period])
      .catch((err) => {
        this.logger.warn(`Usage increment failed for ${feature}: ${err.message}`);
      });
  }

  /**
   * Returns the current period string based on limit unit.
   *   per_month → '2026-03'
   *   per_day   → '2026-03-08'
   *   total     → 'all-time'
   *   null      → '2026-03' (default to monthly)
   */
  private currentPeriod(unit: string | null): string {
    const now = new Date();
    if (unit === 'per_day') {
      return now.toISOString().slice(0, 10); // YYYY-MM-DD
    }
    if (unit === 'total') {
      return 'all-time';
    }
    return now.toISOString().slice(0, 7); // YYYY-MM
  }
}
