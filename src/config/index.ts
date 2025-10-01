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
  userAgent: string; // fallback UA single string
  usePuppeteer: boolean;
  proxyList: string[]; // list of proxies (host:port or with auth)
  proxyRotation: boolean;
  userAgents: string[]; // list of UAs to rotate
  maxConcurrency: number; // worker concurrency
  rateLimitRequests: number; // number of requests per interval
  rateLimitIntervalMs: number; // interval window (ms)
  jobTimeoutMs: number;
}

/** small helper that parses an integer env var with fallback */
function parseIntEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (!v) return fallback;
  return v === 'true' || v === '1';
}

const cfg: AppConfig = {
  port: parseIntEnv('PORT', 3000),
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseIntEnv('REDIS_PORT', 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  queuePrefix: process.env.QUEUE_PREFIX || 'nestjs-crawler',
  queueName: process.env.QUEUE_NAME || 'crawl-queue',
  axiosTimeout: parseIntEnv('AXIOS_TIMEOUT', 15000),
  userAgent:
    process.env.USER_AGENT || 'Mozilla/5.0 (compatible; NestCrawler/1.0)',
  usePuppeteer: parseBoolEnv('USE_PUPPETEER', false),
  proxyList: (process.env.PROXY_LIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  proxyRotation: parseBoolEnv('PROXY_ROTATION', true),
  userAgents: (process.env.USER_AGENTS || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean),
  maxConcurrency: parseIntEnv('MAX_CONCURRENCY', 3),
  rateLimitRequests: parseIntEnv('RATE_LIMIT_REQUESTS', 10),
  rateLimitIntervalMs: parseIntEnv('RATE_LIMIT_INTERVAL_MS', 1000),
  jobTimeoutMs: parseIntEnv('JOB_TIMEOUT_MS', 120000),
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
