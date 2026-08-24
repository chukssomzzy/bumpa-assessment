import { readHandoff } from './containers';

// Published by globalSetup; read here so every worker sees the same containers.
const handoff = readHandoff();
process.env.DATABASE_URL = handoff.databaseUrl;
process.env.REDIS_URL = handoff.redisUrl;
process.env.WEBHOOK_SECRET ??= 'test-webhook-secret';
process.env.PAYMENT_PROVIDER = 'fake';
process.env.NODE_ENV = 'test';

jest.setTimeout(60_000);
