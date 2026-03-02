import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { TenantQueryRunnerService } from '@database/tenant-query-runner.service';
import { TooManyRequestsException } from '@common/exceptions/too-many-requests.exception';
import { getTenantContext } from '@common/context/tenant-context';

/**
 * Sliding Window script for Redis
 * ARGV[1]: Current Timestamp
 * ARGV[2]: Window Size (ms)
 * ARGV[3]: Max Requests Allowed
 */
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

/**
 * Limits based on the 'slug' field in public.subscription_plans
 */
const TIER_LIMITS: Record<string, number> = {
  free: 10,
  basic: 60,
  standard: 120,
  enterprise: 300,
};

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);

  constructor(
    @Optional() @InjectRedis() private readonly redis: Redis,
    private readonly tenantDb: TenantQueryRunnerService,
  ) {}

  async enforce(): Promise<void> {
    const ctx = getTenantContext();
    const tenantId = ctx?.tenantId;
    console.log('🔍 LATE LIMITTER:', JSON.stringify(ctx.schemaName));
    // 1. Safety Check: Context
    if (!tenantId) {
      this.logger.warn('Rate limit check skipped: No tenant context found.');
      return;
    }

    // 2. Safety Check: Redis availability
    if (!this.redis) {
      this.logger.error('Redis not available; failing open but logging error');
      return;
    }

    const cacheKey = `tenant_tier:${tenantId}`;
    let tier = await this.redis.get(cacheKey);

    // 3. Resolve Tier if not in Cache
    if (!tier) {
      try {
        /**
         * FIX: We JOIN tenants -> subscriptions -> subscription_plans
         * to find the 'slug' (free, basic, etc.) because 'plan_tier' column
         * does not exist on the tenants table.
         */
        const rows = await this.tenantDb.executePublic<{ slug: string }>(
          `
          SELECT sp.slug 
          FROM public.tenants t
          LEFT JOIN public.subscriptions s ON s.tenant_id = t.id
          LEFT JOIN public.subscription_plans sp ON s.plan_id = sp.id
          WHERE t.id = $1
          AND (s.status = 'active' OR s.status = 'trial')
          ORDER BY s.created_at DESC
          LIMIT 1
          `,
          [tenantId],
        );

        tier = rows[0]?.slug ?? 'free';

        // Cache for 5 minutes to reduce DB load
        await this.redis.setex(cacheKey, 300, tier);
      } catch (error) {
        this.logger.error(`Failed to resolve tenant tier for ${tenantId}: ${error.message}`);
        tier = 'free'; // Fallback to safest limit on DB error
      }
    }

    // 4. Apply Rate Limiting
    const limit = TIER_LIMITS[tier] ?? TIER_LIMITS.free;
    const windowMs = 60_000; // 1 minute window

    try {
      const result = (await this.redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        `rl:chat:${tenantId}`,
        String(Date.now()),
        String(windowMs),
        String(limit),
      )) as number;

      if (result !== 1) {
        this.logger.warn(
          `Rate limit exceeded — Tenant: ${tenantId}, Tier: ${tier}, Limit: ${limit}`,
        );
        throw new TooManyRequestsException(
          `Rate limit exceeded for your ${tier} plan. Please slow down.`,
        );
      }
    } catch (error) {
      if (error instanceof TooManyRequestsException) throw error;
      this.logger.error(`Redis execution error in RateLimiter: ${error.message}`);
      // Fail open (allow request) if Redis script crashes to avoid blocking users
    }
  }
}
