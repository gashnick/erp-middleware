import { createClient } from 'redis';

export const redis = createClient({ url: process.env.REDIS_URL });

redis.on('error', (err) => console.error({ msg: 'redis_error', err }));

redis.connect().catch((err) => console.error({ msg: 'redis_connect_error', err }));

// Sliding-window rate limit — atomic Lua script (no race conditions)
const RATE_LIMIT_SCRIPT = `
  local key    = KEYS[1]
  local now    = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local limit  = tonumber(ARGV[3])

  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
  local count = redis.call('ZCARD', key)

  if count < limit then
    redis.call('ZADD', key, now, now .. '-' .. math.random(1e9))
    redis.call('EXPIRE', key, math.ceil(window / 1000))
    return 1
  end
  return 0
`;

export async function checkRateLimit(
  key: string,
  windowMs: number,
  limit: number,
): Promise<boolean> {
  const now = Date.now();
  const result = await redis.eval(RATE_LIMIT_SCRIPT, {
    keys: [key],
    arguments: [String(now), String(windowMs), String(limit)],
  });
  return result === 1;
}
