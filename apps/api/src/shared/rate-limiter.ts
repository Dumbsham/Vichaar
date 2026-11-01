import { createHash } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';

export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<boolean>;
  close(): Promise<void>;
}
const tokenBucketScript = `local values = redis.call('HMGET', KEYS[1], 'tokens', 'updated')
local capacity = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local tokens = tonumber(values[1]) or capacity
local updated = tonumber(values[2]) or now_ms
tokens = math.min(capacity, tokens + math.max(0, now_ms - updated) * capacity / window_ms)
local allowed = 0
if tokens >= 1 then tokens = tokens - 1; allowed = 1 end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'updated', now_ms)
redis.call('PEXPIRE', KEYS[1], window_ms * 2)
return allowed`;
function timeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Rate limiter timed out')), milliseconds);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
export function createRateLimiter(redisUrl: string, now: () => number = Date.now, namespace = 'auth-rate'): RateLimiter {
  let client: RedisClientType | undefined;
  let disabledUntil = 0;
  const fallback = new Map<string, { count: number; resetAt: number }>();
  async function redisClient(): Promise<RedisClientType> {
    if (!client) {
      client = createClient({
        url: redisUrl,
        socket: { connectTimeout: 200, reconnectStrategy: false },
        disableOfflineQueue: true,
      });
      client.on('error', () => {});
    }
    if (!client.isOpen) await timeout(client.connect(), 300);
    return client;
  }
  return {
    async consume(key, limit, windowSeconds) {
      const hashedKey = `${namespace}:${createHash('sha256').update(key).digest('hex')}`;
      const current = now();
      if (current >= disabledUntil) {
        try {
          const redis = await redisClient();
          const allowed = await timeout(
            redis.eval(tokenBucketScript, {
              keys: [hashedKey],
              arguments: [String(limit), String(windowSeconds * 1000), String(current)],
            }),
            300,
          );
          return Number(allowed) === 1;
        } catch {
          if (client?.isOpen) client.destroy();
          client = undefined;
          disabledUntil = current + 30_000 + Math.floor(Math.random() * 5_000);
        }
      }
      for (const [address, attempt] of fallback)
        if (attempt.resetAt <= current) fallback.delete(address);
      const prior = fallback.get(hashedKey);
      const attempt =
        prior && prior.resetAt > current
          ? prior
          : { count: 0, resetAt: current + windowSeconds * 1000 };
      attempt.count++;
      fallback.set(hashedKey, attempt);
      return attempt.count <= Math.min(limit, 5);
    },
    async close() {
      if (client?.isOpen) client.destroy();
      client = undefined;
    },
  };
}
