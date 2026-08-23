import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { setupDatabase } from '../../src/database/migrate';
import { writeHandoff } from './containers';

declare global {
  var __PG__: StartedPostgreSqlContainer | undefined;
  var __REDIS__: StartedRedisContainer | undefined;
}

/**
 * Real Postgres and Redis, started once for the whole run.
 *
 * The design rests on an exclusive row lock, ON CONFLICT DO NOTHING and a
 * per-group DISTINCT query — all Postgres behaviours. Testing against sqlite or a
 * mock would exercise the ORM rather than the design.
 */
export default async function globalSetup(): Promise<void> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);

  const databaseUrl = postgres.getConnectionUri();
  const redisUrl = redis.getConnectionUrl();

  // The same entrypoint compose uses: migrations then seeds, never one without
  // the other.
  await setupDatabase(databaseUrl);

  globalThis.__PG__ = postgres;
  globalThis.__REDIS__ = redis;
  writeHandoff({ databaseUrl, redisUrl });
}
