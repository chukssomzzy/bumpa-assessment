import { createHmac, randomUUID } from 'node:crypto';
import { Client } from 'pg';

/**
 * Proves the real Paystack webhook path, end to end, over the public internet.
 *
 * Unlike every other tier, this test depends on a third party choosing to send
 * us something. That is deliberate: a tunnel that silently stopped routing is
 * exactly the failure no local test can see. It stays manual-only and outside
 * CI, where that dependency costs nothing.
 *
 * PREREQUISITES — all four, or this cannot pass:
 *   1. `docker compose --profile tunnel up -d --wait` with a valid
 *      CLOUDFLARE_TUNNEL_TOKEN.
 *   2. PAYMENT_PROVIDER=paystack and a real test-mode PAYSTACK_SECRET_KEY in .env.
 *   3. The tunnel's public hostname registered as the TEST-MODE webhook URL in
 *      the Paystack dashboard, pointing at `/webhooks/paystack`.
 *   4. OTP-for-transfers DISABLED on the Paystack account. With OTP on, transfer
 *      initiation returns `otp`, the transfer never completes, and no webhook is
 *      ever emitted.
 */
const API = process.env.API_URL ?? 'http://localhost:3000';
const SECRET = process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me';
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://bumpa:bumpa@localhost:5432/bumpa';

/** A user of our own, so a rerun never collides with the seeded demo users. */
const USER = randomUUID();

/** Paystack's own delivery latency is unbounded; this is a pragmatic ceiling. */
const WEBHOOK_TIMEOUT_MS = Number(process.env.E2E_WEBHOOK_TIMEOUT_MS ?? 120_000);

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  // A user of our own, carrying bank details Paystack test mode will actually
  // resolve. 044/0000000000 is verified working; most combinations answer
  // "Cannot resolve account", which surfaces as a 400 that leaves the payout
  // retrying rather than as an obvious setup error. See DEMO_USERS in
  // `src/database/seeds/definitions.ts`. `name` is NOT NULL.
  await db.query(
    `INSERT INTO users (id, name, email, bank_code, account_number)
     VALUES ($1, $2, $3, '044', '0000000000') ON CONFLICT (id) DO NOTHING`,
    [USER, 'E2E Webhook', `e2e-${USER}@example.test`],
  );
});

afterAll(async () => {
  await db?.end();
});

function postPurchase() {
  const raw = JSON.stringify({
    type: 'purchase.completed',
    eventId: randomUUID(),
    userId: USER,
    occurredAt: new Date().toISOString(),
  });
  const timestamp = Math.floor(Date.now() / 1000);
  return fetch(`${API}/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature': createHmac('sha512', SECRET).update(`${timestamp}.${raw}`).digest('hex'),
      'x-timestamp': String(timestamp),
    },
    body: raw,
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pollFor<T>(
  describe: string,
  probe: () => Promise<T | undefined>,
  timeoutMs: number,
  onTimeout: () => Promise<string>,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await probe();
    if (found !== undefined) return found;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for ${describe}.\n${await onTimeout()}`,
      );
    }
    await sleep(1000);
  }
}

describe('paystack transfer webhook, end to end', () => {
  it('settles a cashback payout from a webhook Paystack actually delivered', async () => {
    // Enough purchases to cross into the Intermediate badge and mint a payout.
    for (let i = 0; i < 13; i += 1) {
      const response = await postPurchase();
      expect(response.status).toBe(202);
    }

    const payout = await pollFor(
      'a cashback payout to be created',
      async () => {
        const { rows } = await db.query<{ id: string; provider_reference: string }>(
          `SELECT id, provider_reference FROM payouts WHERE user_id = $1 LIMIT 1`,
          [USER],
        );
        return rows[0];
      },
      60_000,
      async () =>
        'No payout row appeared. Evaluation or badge minting failed before the money path.',
    );

    // THE ASSERTION THAT MATTERS. Payout status is NOT usable here: the worker's
    // own dispatch reconciles by reference independently, so a payout reaching
    // `succeeded` proves nothing about whether the webhook was delivered — the
    // test would go green with the tunnel completely broken. The receipt row is
    // written only by the webhook handler, so it is the one durable signal that
    // Paystack reached us.
    const receipt = await pollFor(
      'Paystack to deliver a transfer webhook through the tunnel',
      async () => {
        const { rows } = await db.query<{ event_id: string }>(
          `SELECT event_id FROM processed_events
           WHERE event_id LIKE 'paystack:transfer.%:' || $1 || ':%' LIMIT 1`,
          [payout.provider_reference],
        );
        return rows[0];
      },
      WEBHOOK_TIMEOUT_MS,
      async () => {
        const { rows } = await db.query(
          `SELECT status, attempts, last_error FROM payouts WHERE id = $1`,
          [payout.id],
        );
        return [
          `Payout state: ${JSON.stringify(rows[0])}`,
          `Reference: ${payout.provider_reference}`,
          '',
          'No webhook receipt was written. Check, in this order:',
          '  1. Is the tunnel up?  docker compose --profile tunnel ps',
          '  2. Is the tunnel hostname registered as the TEST-MODE webhook URL in the',
          '     Paystack dashboard, pointing at /webhooks/paystack?',
          '  3. Is OTP-for-transfers disabled on the account? With OTP on, the transfer',
          "     returns 'otp', never completes, and Paystack emits no event at all.",
          '  4. Does PAYSTACK_SECRET_KEY in .env match the account that owns that',
          '     webhook URL? A mismatch makes the guard reject every delivery as 401.',
        ].join('\n');
      },
    );

    expect(receipt.event_id).toContain(payout.provider_reference);

    // Having proven delivery, the outcome should follow.
    const settled = await pollFor(
      'the payout to reach a terminal state',
      async () => {
        const { rows } = await db.query<{ status: string }>(
          `SELECT status FROM payouts WHERE id = $1 AND status IN ('succeeded','failed')`,
          [payout.id],
        );
        return rows[0];
      },
      60_000,
      async () => 'Webhook arrived but the payout never settled — reconciliation is broken.',
    );

    expect(settled.status).toBe('succeeded');
  });

  it('rejects a webhook that is not signed by Paystack', async () => {
    const response = await fetch(`${API}/webhooks/paystack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-paystack-signature': 'deadbeef' },
      body: JSON.stringify({ event: 'transfer.success', data: { reference: 'whatever' } }),
    });

    expect(response.status).toBe(401);
  });
});
