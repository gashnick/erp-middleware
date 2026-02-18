import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
// Use runtime require for ioredis to avoid strict type dependency when package isn't installed
// eslint-disable-next-line @typescript-eslint/no-var-requires
const IORedis = require('ioredis');
import { Tenant } from '@tenants/entities/tenant.entity';

interface RateLimitConfig {
  basic: number;
  standard: number;
  enterprise: number;
}

@Injectable()
export class TenantRateLimitGuard implements CanActivate {
  private redis: any;
  private readonly limits: RateLimitConfig = {
    basic: 60, // 60 requests/minute
    standard: 120,
    enterprise: 300,
  };

  constructor(
    @InjectRepository(Tenant)
    private tenantRepo: Repository<Tenant>,
    private reflector: Reflector,
  ) {
    this.redis = new IORedis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.tenantId) {
      return true;
    }

    // Load subscription and plan relations to determine tenant tier
    const tenant = await this.tenantRepo.findOne({
      where: { id: user.tenantId },
      relations: ['subscription', 'subscription.plan'],
    });

    if (!tenant) {
      throw new HttpException('Tenant not found', HttpStatus.UNAUTHORIZED);
    }

    const planKey = (tenant?.subscription as any)?.plan?.slug?.toLowerCase() || 'basic';
    const limit = (this.limits as any)[planKey] || this.limits.basic;
    const key = `rate_limit:${tenant.id}:${Math.floor(Date.now() / 60000)}`;

    const current = await this.redis.incr(key);
    if (current === 1) {
      await this.redis.expire(key, 60);
    }

    if (current > limit) {
      throw new HttpException(
        {
          statusCode: 429,
          message: 'Rate limit exceeded',
          limit,
          current,
          retryAfter: 60,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const response = context.switchToHttp().getResponse();
    response.setHeader('X-RateLimit-Limit', limit);
    response.setHeader('X-RateLimit-Remaining', Math.max(0, limit - current));
    response.setHeader('X-RateLimit-Reset', Math.floor(Date.now() / 1000) + 60);

    return true;
  }
}
