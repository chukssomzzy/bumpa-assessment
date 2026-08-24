import { Client } from 'pg';
import {
  API,
  connectDatabase,
  givenPayableUser,
  readPayout,
  readWebhookReceipts,
  until,
  whenPurchaseIsPosted,
} from './fixtures';

/**
 * Proves the real Paystack webhook path, end to end, over the public internet.
 *
 * Unlike every other tier, this depends on a third party choosing to send us
 * something. That is deliberate: a tunnel that silently stopped routing is
 * exactly the failure no local test can see.
 *
 * PREREQUISITES — all four, or this cannot pass:
 *   1. `docker compose --profile tunnel up -d --wait` with a valid
 *      CLOUDFLARE_TUNNEL_TOKEN (or COMPOSE_PROFILES=tunnel in .env).
 *   2. PAYMENT_PROVIDER=paystack and a real test-mode PAYSTACK_SECRET_KEY.
 *   3. The tunnel's public hostname registered as the TEST-MODE webhook URL in
 *      the Paystack dashboard, pointing at `/webhooks/paystack`.
 *   4. Bank details Paystack test mode can resolve — see `givenPayableUser`.
 */
const WEBHOOK_TIMEOUT_MS = Number(process.env.E2E_WEBHOOK_TIMEOUT_MS ?? 120_000);

describe('Feature: reconciling a payout from a Paystack transfer webhook', () => {
  let db: Client;
  let customer: string;

  beforeAll(async () => {
    db = await connectDatabase();
    customer = await givenPayableUser(db, 'E2E Webhook');
  });

  afterAll(async () => {
    await db?.end();
  });

  describe('Scenario: Paystack reports that a cashback transfer succeeded', () => {
    it('Given a cashback payout dispatched to Paystack, When Paystack delivers transfer.success through the tunnel, Then the delivery is recorded and the payout settles', async () => {
      // Given
      for (let i = 0; i < 13; i += 1) {
        expect((await whenPurchaseIsPosted(customer)).status).toBe(202);
      }
      const payout = await until(
        'a cashback payout to be created',
        () => readPayout(db, customer),
        60_000,
        async () =>
          'No payout row appeared. Evaluation or badge minting failed before the money path.',
      );

      // When
      // Nothing to do — Paystack sends this of its own accord once the worker's
      // transfer completes. Waiting IS the step.

      // Then
      // THE ASSERTION THAT MATTERS. Payout status is NOT usable as evidence
      // here: the worker's own dispatch reconciles by reference independently,
      // so a payout reaching `succeeded` proves nothing about whether the
      // webhook was delivered — this would go green with the tunnel completely
      // dead. The receipt row is written only by the webhook handler.
      const receipts = await until(
        'Paystack to deliver a transfer webhook through the tunnel',
        async () => {
          const found = await readWebhookReceipts(db, payout.provider_reference);
          return found.length > 0 ? found : undefined;
        },
        WEBHOOK_TIMEOUT_MS,
        async () => {
          const current = await readPayout(db, customer);
          return [
            `Payout state: ${JSON.stringify(current)}`,
            `Reference: ${payout.provider_reference}`,
            '',
            'No webhook receipt was written. Check, in this order:',
            '  1. Is the tunnel up?  docker compose --profile tunnel ps',
            '  2. Is the tunnel hostname registered as the TEST-MODE webhook URL in',
            '     the Paystack dashboard, pointing at /webhooks/paystack?',
            '  3. Does the tunnel Public Hostname route to `api:3000` (not localhost)?',
            '  4. Does PAYSTACK_SECRET_KEY match the account owning that webhook URL?',
            '     A mismatch makes the guard reject every delivery as 401.',
          ].join('\n');
        },
      );

      expect(receipts[0]).toContain(payout.provider_reference);

      const settled = await until(
        'the payout to reach a terminal state',
        async () => {
          const current = await readPayout(db, customer);
          return current && ['succeeded', 'failed'].includes(current.status) ? current : undefined;
        },
        60_000,
        async () => 'Webhook arrived but the payout never settled — reconciliation is broken.',
      );

      expect(settled.status).toBe('succeeded');
    });
  });

  describe('Scenario: a webhook arrives that Paystack did not sign', () => {
    it('Given the webhook endpoint is reachable, When a transfer event carries an invalid signature, Then it is rejected as unauthorized', async () => {
      // Given
      const raw = JSON.stringify({
        event: 'transfer.success',
        data: { reference: 'whatever', status: 'success' },
      });

      // When
      const response = await fetch(`${API}/webhooks/paystack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-paystack-signature': 'deadbeef' },
        body: raw,
      });

      // Then
      expect(response.status).toBe(401);
    });
  });
});
