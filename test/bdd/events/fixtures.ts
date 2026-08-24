import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DEMO_USER_ID, sign } from '../support/application/app-harness';
import type { BddWorld } from '../support/application/bdd-world';

export const purchase = (userId = DEMO_USER_ID, eventId = randomUUID()) => ({
  type: 'purchase.completed' as const,
  eventId,
  userId,
  occurredAt: new Date().toISOString(),
});

/** Signs and posts the exact bytes given to `sign`, so tampering is meaningful. */
export function postRaw(
  world: BddWorld,
  raw: string,
  headers: Record<string, string>,
): request.Test {
  return request(world.app.getHttpServer())
    .post('/events')
    .set('content-type', 'application/json')
    .set(headers)
    .send(raw);
}

/** Posts a validly signed purchase event. */
export function postSigned(world: BddWorld, payload: unknown): request.Test {
  const raw = JSON.stringify(payload);
  return postRaw(world, raw, sign(raw));
}

/** Posts a purchase event with no signature headers at all. */
export function postUnsigned(world: BddWorld, raw: string): request.Test {
  return request(world.app.getHttpServer())
    .post('/events')
    .set('content-type', 'application/json')
    .send(raw);
}

export async function readPurchaseCount(world: BddWorld, userId: string): Promise<number> {
  const rows = await world.dataSource.query(
    'SELECT purchase_count FROM user_progress WHERE user_id = $1',
    [userId],
  );
  return rows[0]?.purchase_count ?? -1;
}

export async function readUnlockedKeys(world: BddWorld, userId: string): Promise<string[]> {
  const rows = await world.dataSource.query(
    'SELECT achievement_key FROM user_achievements WHERE user_id = $1 ORDER BY achievement_key',
    [userId],
  );
  return rows.map((r: { achievement_key: string }) => r.achievement_key);
}

export async function readBadgeKeysBeyondBeginner(
  world: BddWorld,
  userId: string,
): Promise<string[]> {
  const rows = await world.dataSource.query(
    "SELECT badge_key FROM user_badges WHERE user_id = $1 AND badge_key != 'beginner'",
    [userId],
  );
  return rows.map((r: { badge_key: string }) => r.badge_key);
}

export async function readPayoutRows(
  world: BddWorld,
  userId: string,
): Promise<
  { status: string; amount_kobo: number; provider_reference: string | null; badge_key: string }[]
> {
  return world.dataSource.query('SELECT * FROM payouts WHERE user_id = $1', [userId]);
}

/** The dedupe receipt for one event id: exactly the row `recordEventIfNew` writes. */
export async function readProcessedEvents(
  world: BddWorld,
  eventId: string,
): Promise<{ event_id: string }[]> {
  return world.dataSource.query('SELECT event_id FROM processed_events WHERE event_id = $1', [
    eventId,
  ]);
}

export async function readAchievementsView(world: BddWorld, userId: string): Promise<request.Test> {
  return request(world.app.getHttpServer()).get(`/users/${userId}/achievements`);
}
