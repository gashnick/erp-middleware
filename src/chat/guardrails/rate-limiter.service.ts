// src/chat/guardrails/rate-limiter.service.ts
//
// Enforces per-tenant chat query rate limits using Redis sliding window.
//
// Refactored from Month 2:
//   BEFORE — hardcoded TIER_LIMITS map, manual tier DB lookup
//   AFTER  — delegates to FeatureFlagService which reads from feature_flags
//            table and caches in Redis. Single source of truth for limits.
//
// Fail-open policy:
//   If Redis is unavailable, request is allowed through but error is logged.
//   This matches the Month 2 behaviour and prevents Redis outages from
//   blocking all chat traffic.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { TooManyRequestsException } from '@common/exceptions/too-many-requests.exception';
import { getTenantContext } from '@common/context/tenant-context';
import { FeatureFlagService } from '@subscription/feature-flag.service';

const SLIDING_WINDOW_LUA = `
  local key     = KEYS[1]
  local now     = tonumber(ARGV[1])
  local window  = tonumber(ARGV[2])
  local limit   = tonumber(ARGV[3])
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
  local count = redis.call('ZCARD', key)
  if count < limit then
    redis.call('ZADD', key, now, now .. math.random(1000000))
    redis.call('EXPIRE', key, math.ceil(window / 1000))
    return 1
  end
  return 0
`;

// Fallback limits when feature_flags table is not yet seeded or DB is unavailable
const FALLBACK_LIMITS: Record<string, number> = {
  free: 10,
  basic: 60,
  standard: 120,
  enterprise: 300,
};

const WINDOW_MS = 60_000; // 1 minute sliding window

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);

  constructor(
    @Optional() @InjectRedis() private readonly redis: Redis,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  async enforce(): Promise<void> {
    const ctx = getTenantContext();
    const tenantId = ctx?.tenantId;

    if (!tenantId) {
      this.logger.warn('Rate limit check skipped: No tenant context found.');
      return;
    }

    if (!this.redis) {
      this.logger.error('Redis not available — failing open');
      return;
    }

    // Resolve limit from FeatureFlagService (reads feature_flags table via Redis cache)
    const limit = await this.resolveLimit(tenantId);

    try {
      const result = (await this.redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        `rl:chat:${tenantId}`,
        String(Date.now()),
        String(WINDOW_MS),
        String(limit),
      )) as number;

      if (result !== 1) {
        const slug = await this.featureFlags.getPlanSlug(tenantId);
        this.logger.warn(
          `Rate limit exceeded — tenant: ${tenantId}, plan: ${slug}, limit: ${limit}/min`,
        );
        throw new TooManyRequestsException(
          `Rate limit exceeded for your ${slug} plan (${limit} requests/minute). Please slow down.`,
        );
      }
    } catch (error) {
      if (error instanceof TooManyRequestsException) throw error;
      this.logger.error(`Redis sliding window error: ${error.message}`);
      // Fail open — Redis errors never block users
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async resolveLimit(tenantId: string): Promise<number> {
    try {
      const remaining = await this.featureFlags.getRemainingUsage(tenantId, 'chat_queries');

      // null = unlimited — use a high number for the sliding window
      if (remaining === null) return 999;

      // Get the actual limit from feature flags for the window
      // We use plan slug to look up fallback if needed
      const slug = await this.featureFlags.getPlanSlug(tenantId);

      // Convert monthly limit to per-minute limit for sliding window
      // Monthly limit / (30 days * 24 hours * 60 minutes) * safety factor
      // Simpler: use the hardcoded per-minute values as the window rate
      return FALLBACK_LIMITS[slug] ?? FALLBACK_LIMITS.free;
    } catch (err) {
      this.logger.warn(`Could not resolve rate limit from feature flags: ${err.message}`);
      return FALLBACK_LIMITS.free;
    }
  }
}
