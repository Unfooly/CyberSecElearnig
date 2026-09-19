import { ConnectionOptions } from 'bullmq';

/**
 * REDIS_URL (redis://[user:pass@]host:port[/db], rediss:// = TLS) -> opcje
 * połączenia BullMQ. Własny parser zamiast przekazywania URL-a, bo BullMQ
 * przyjmuje obiekt opcji ioredis.
 */
export function redisConnectionFromUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('REDIS_URL musi zaczynać się od redis:// albo rediss://');
  }
  const db = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined;
  if (db !== undefined && !Number.isInteger(db)) {
    throw new Error('REDIS_URL: numer bazy w ścieżce musi być liczbą całkowitą');
  }
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number.isInteger(db) ? db : undefined,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    // Wymagane przez Worker BullMQ (blokujące komendy).
    maxRetriesPerRequest: null,
  };
}
