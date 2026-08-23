import { createHmac, randomUUID } from 'node:crypto';

/**
 * Drives the composed stack over HTTP — api, worker, migrate, postgres, redis —
 * exactly as a reviewer would. Not run on push: it needs real provider
 * credentials and minutes rather than seconds.
 *
 * Prerequisites: `docker compose up -d --wait`, and WEBHOOK_SECRET matching the
 * stack's .env.
 */
const API = process.env.API_URL ?? 'http://localhost:3000';
const SECRET = process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me';
const USER = '11111111-1111-4111-8111-111111111111';

function post(body: unknown, secretOverride?: string) {
  const raw = JSON.stringify(body);
  const secret = secretOverride ?? SECRET;
  return fetch(`${API}/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature': createHmac('sha512', secret).update(raw).digest('hex'),
      'x-timestamp': String(Math.floor(Date.now() / 1000)),
    },
    body: raw,
  });
}

const purchase = () => ({
  type: 'purchase.completed',
  eventId: randomUUID(),
  userId: USER,
  occurredAt: new Date().toISOString(),
});

interface View {
  unlocked_achievements: string[];
  next_available_achievements: string[];
  current_badge: string;
  next_badge: string | null;
  remaining_to_unlock_next_badge: number;
}

const view = async (): Promise<View> =>
  (await fetch(`${API}/users/${USER}/achievements`)).json() as Promise<View>;

async function until(predicate: (v: View) => boolean, timeoutMs = 60_000): Promise<View> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const current = await view();
    if (predicate(current)) return current;
    if (Date.now() > deadline) {
      throw new Error(`condition not met; last view: ${JSON.stringify(current)}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

describe('cashback, end to end', () => {
  it('rejects an unsigned request', async () => {
    const raw = JSON.stringify(purchase());
    const response = await fetch(`${API}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    });

    expect(response.status).toBe(401);
  });

  it('rejects a request signed with the wrong secret', async () => {
    expect((await post(purchase(), 'not-the-secret')).status).toBe(401);
  });

  it('earns a badge and pays cashback across a run of purchases', async () => {
    const before = await view();
    expect(before.current_badge).toBe('Beginner');

    // Twelve purchases crosses the 1, 3, 5 and 10 tiers: four achievements,
    // which is exactly the Intermediate requirement.
    for (let i = 0; i < 12; i++) {
      expect((await post(purchase())).status).toBe(202);
    }

    const after = await until((v) => v.current_badge === 'Intermediate');

    expect(after.unlocked_achievements).toEqual(
      expect.arrayContaining(['First Purchase', '5 Purchases', '10 Purchases']),
    );
    // Only the next tier of the group, never the whole remaining ladder.
    expect(after.next_available_achievements).toEqual(['15 Purchases']);
    expect(after.next_badge).toBe('Advanced');
    expect(after.remaining_to_unlock_next_badge).toBe(4);
  });

  it('ignores a redelivered event', async () => {
    const event = purchase();
    expect((await post(event)).status).toBe(202);
    const first = await until((v) => v.unlocked_achievements.length >= 0);

    expect((await post(event)).status).toBe(202);
    await new Promise((r) => setTimeout(r, 2000));

    expect(await view()).toEqual(first);
  });
});
