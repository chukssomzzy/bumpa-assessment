import { createHmac, randomUUID } from 'node:crypto';
import { Client } from 'pg';

/**
 * Shared steps for the end-to-end tier.
 *
 * Unlike the BDD tier there is no in-process world to hand around: these
 * scenarios drive a composed `docker compose` stack over the network, exactly
 * as a reviewer would, so the only handles are an HTTP base URL and a direct
 * database connection for reading state the API does not expose.
 */

export const API = process.env.API_URL ?? 'http://localhost:3000';
export const STOREFRONT_SECRET = process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me';
export const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ?? '';
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://bumpa:bumpa@localhost:5432/bumpa';

export interface AchievementsView {
  unlocked_achievements: string[];
  next_available_achievements: string[];
  current_badge: string;
  next_badge: string | null;
  remaining_to_unlock_next_badge: number;
}

export interface PayoutRow {
  id: string;
  status: string;
  attempts: number;
  provider_reference: string;
  last_error: string | null;
}

export const connectDatabase = async (): Promise<Client> => {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  return db;
};

/**
 * Provisions a user this run owns outright, with bank details Paystack test
 * mode will actually resolve.
 *
 * A run must never reuse a seeded demo user. The scenarios below assert
 * absolute positions — "starts at Beginner", "ends at Intermediate" — so a
 * shared user carries state from the previous run, and the suite would pass
 * exactly once and fail forever afterwards against a database behaving
 * perfectly correctly.
 *
 * 044/0000000000 is verified working; most combinations answer "Cannot resolve
 * account". See DEMO_USERS in `src/database/seeds/definitions.ts`.
 */
export const givenPayableUser = async (db: Client, label: string): Promise<string> => {
  const id = randomUUID();
  await db.query(
    `INSERT INTO users (id, name, email, bank_code, account_number)
     VALUES ($1, $2, $3, '044', '0000000000') ON CONFLICT (id) DO NOTHING`,
    [id, label, `e2e-${id}@example.test`],
  );
  return id;
};

const purchaseBody = (userId: string) =>
  JSON.stringify({
    type: 'purchase.completed',
    eventId: randomUUID(),
    userId,
    occurredAt: new Date().toISOString(),
  });

/** The storefront convention: hex SHA-512 over `{timestamp}.{body}`. */
export const storefrontHeaders = (raw: string, secret = STOREFRONT_SECRET) => {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    'content-type': 'application/json',
    'x-signature': createHmac('sha512', secret).update(`${timestamp}.${raw}`).digest('hex'),
    'x-timestamp': String(timestamp),
  };
};

/** Paystack's convention: hex SHA-512 over the raw body alone, no timestamp. */
export const paystackHeaders = (raw: string) => ({
  'content-type': 'application/json',
  'x-paystack-signature': createHmac('sha512', PAYSTACK_SECRET).update(raw).digest('hex'),
});

export const whenPurchaseIsPosted = (userId: string, secret?: string): Promise<Response> => {
  const raw = purchaseBody(userId);
  return fetch(`${API}/events`, {
    method: 'POST',
    headers: storefrontHeaders(raw, secret),
    body: raw,
  });
};

/** Posts the SAME event twice — the caller controls redelivery. */
export const whenEventIsPosted = (raw: string): Promise<Response> =>
  fetch(`${API}/events`, { method: 'POST', headers: storefrontHeaders(raw), body: raw });

export const readAchievementsView = async (userId: string): Promise<AchievementsView> =>
  (await fetch(`${API}/users/${userId}/achievements`)).json() as Promise<AchievementsView>;

export const readPayout = async (db: Client, userId: string): Promise<PayoutRow | undefined> => {
  const { rows } = await db.query<PayoutRow>(
    `SELECT id, status, attempts, provider_reference, last_error FROM payouts WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  return rows[0];
};

export const readWebhookReceipts = async (db: Client, reference: string): Promise<string[]> => {
  const { rows } = await db.query<{ event_id: string }>(
    `SELECT event_id FROM processed_events WHERE event_id LIKE 'paystack:transfer.%:' || $1 || ':%'`,
    [reference],
  );
  return rows.map((row) => row.event_id);
};

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Polls until `probe` yields a value, then returns it.
 *
 * `onTimeout` builds the diagnostic. These scenarios depend on a live stack, a
 * public tunnel and a third party, so a bare Jest timeout would say nothing
 * about which of those broke.
 */
export const until = async <T>(
  description: string,
  probe: () => Promise<T | undefined>,
  timeoutMs: number,
  onTimeout: () => Promise<string>,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await probe();
    if (found !== undefined) return found;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for ${description}.\n${await onTimeout()}`,
      );
    }
    await sleep(1000);
  }
};

export const untilView = async (
  userId: string,
  predicate: (v: AchievementsView) => boolean,
  timeoutMs = 60_000,
): Promise<AchievementsView> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const current = await readAchievementsView(userId);
    if (predicate(current)) return current;
    if (Date.now() > deadline) {
      throw new Error(`condition not met; last view: ${JSON.stringify(current)}`);
    }
    await sleep(500);
  }
};
