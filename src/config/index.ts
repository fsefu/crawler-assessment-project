import * as dotenv from 'dotenv';
dotenv.config();

/**
 * Minimal typed configuration for the crawler app.
 * Loads values from environment variables and provides sane defaults.
 */

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
}

export interface AppConfig {
  port: number;
  redis: RedisConfig;
  queuePrefix: string;
  queueName: string;
  axiosTimeout: number; // ms
  userAgent: string;
}

/** small helper that parses an integer env var with fallback */
function parseIntEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const cfg: AppConfig = {
  port: parseIntEnv('PORT', 3000),
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseIntEnv('REDIS_PORT', 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  // prefix used by BullMQ (helps keep multiple apps using same Redis separate)
  queuePrefix: process.env.QUEUE_PREFIX || 'nestjs-crawler',
  // the actual queue name used in QueueService / Worker
  queueName: process.env.QUEUE_NAME || 'crawl-queue',
  axiosTimeout: parseIntEnv('AXIOS_TIMEOUT', 15000),
  userAgent:
    process.env.USER_AGENT || 'Mozilla/5.0 (compatible; NestCrawler/1.0)',
};

/**
 * Helper to build an ioredis connection options object
 * Use this when creating IORedis instances or passing connection to BullMQ.
 */
export function getRedisConnectionOptions() {
  const opts: { host: string; port: number; password?: string } = {
    host: cfg.redis.host,
    port: cfg.redis.port,
  };
  if (cfg.redis.password) opts.password = cfg.redis.password;
  return opts;
}

export const config = cfg;
export default config;
