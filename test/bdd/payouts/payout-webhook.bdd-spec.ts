import { randomUUID } from 'node:crypto';
import type { ConfigType } from '@nestjs/config';
import { hmacDigest, type HmacScheme } from '../../../src/common/security/hmac';
import { paymentsConfig } from '../../../src/config/configuration';
import { paystackScheme } from '../../../src/modules/payouts/paystack-signature.guard';
import { DEMO_USER_ID, drainPayoutQueue } from '../support/application/app-harness';
import { createBddWorld, type BddWorld } from '../support/application/bdd-world';
import {
  BADGE_KEY,
  WEBHOOK_TOLERANCE_SECONDS,
  givenPayoutQueueRunning,
  givenPendingPayout,
  givenSucceededPayout,
  paystackEvent,
  postUnsignedWebhook,
  postWebhook,
  readPaystackReceipts,
  readPayoutFor,
} from './fixtures';

/**
 * Exercises `POST /webhooks/paystack`: the Paystack signature boundary, and the
 * receipt row that is the only durable evidence a delivery was acted on.
 *
 * Assertions are on the receipt rows and the payout row, never on payout status
 * transitions the live worker also drives — the webhook is an optimisation, so
 * a status change proves nothing about whether the delivery was processed.
 *
 * The guard fails closed with no secret configured, and the integration env sets
 * none, so this file supplies one BEFORE the app boots and then signs with the
 * value the app actually booted with (read back off `paymentsConfig`), rather
 * than with a constant that could silently drift from it.
 *
 * The env mutation lives here rather than in `./fixtures` on purpose: those
 * fixtures are shared with `payout-dispatch.bdd-spec.ts`, and a module-scope
 * env write in them would leak a Paystack secret into a suite that boots
 * without one today.
 */
const PAYSTACK_SECRET_KEY = 'test-paystack-secret-key';
const previousPaystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
process.env.PAYSTACK_SECRET_KEY = PAYSTACK_SECRET_KEY;

describe('Feature: acting on Paystack transfer webhooks', () => {
  let world: BddWorld;
  let scheme: HmacScheme;

  /** Signs the exact bytes given, Paystack's way: the raw body alone. */
  const paystackHeaders = (raw: string): Record<string, string> => ({
    'x-paystack-signature': hmacDigest(scheme, raw),
  });

  beforeAll(async () => {
    world = await createBddWorld();
    scheme = paystackScheme(world.app.get<ConfigType<typeof paymentsConfig>>(paymentsConfig.KEY));
    expect(scheme.secret).toBe(PAYSTACK_SECRET_KEY);
  });

  beforeEach(async () => {
    // `resetScenario()` truncates and then drops leftover jobs (`clearQueues`)
    // before this resume: resuming first would release a paused job from the
    // previous scenario into a truncate that is still in flight.
    await world.resetScenario();
    await givenPayoutQueueRunning(world);
  });

  afterEach(() => world.verifyScenario());

  afterAll(async () => {
    await world?.payoutQueue.resume().catch(() => undefined);
    await world?.close();
    if (previousPaystackSecretKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = previousPaystackSecretKey;
  });

  // --- the Paystack signature boundary -------------------------------------

  describe('Scenario: a delivery arrives unsigned', () => {
    it('Given a well-formed transfer.success delivery, When it is posted with no signature header, Then it is rejected as unauthenticated', async () => {
      // Given
      const raw = JSON.stringify(paystackEvent('transfer.success', 'any-reference', 'success'));

      // When
      const response = await postUnsignedWebhook(world, raw);

      // Then
      expect(response.status).toBe(401);
    });
  });

  describe('Scenario: a delivery is signed with the storefront scheme instead', () => {
    it('Given a delivery signed over {timestamp}.{body} under the Paystack key, When it is posted to the Paystack webhook, Then it is rejected because the two schemes are not interchangeable', async () => {
      // Given
      // Same secret, same SHA-512, same header — the ONLY difference is that the
      // storefront binds the timestamp into the signed payload. If the two
      // schemes were interchangeable this would be accepted, and the storefront
      // freshness window would be worth nothing on this endpoint.
      const storefrontShaped: HmacScheme = {
        ...scheme,
        timestamp: { header: 'x-timestamp', toleranceSeconds: WEBHOOK_TOLERANCE_SECONDS },
      };
      const raw = JSON.stringify(paystackEvent('transfer.success', 'any-reference', 'success'));
      const timestamp = String(Math.floor(Date.now() / 1000));

      // When
      const response = await postWebhook(world, raw, {
        'x-paystack-signature': hmacDigest(storefrontShaped, raw, timestamp),
        'x-timestamp': timestamp,
      });

      // Then
      expect(response.status).toBe(401);
    });
  });

  // --- once signed ----------------------------------------------------------

  describe('Scenario: a signed delivery names a reference this system never issued', () => {
    it('Given a transfer.success for an unknown reference, When it is posted correctly signed, Then it is answered 2xx and no receipt is recorded', async () => {
      // Given
      const raw = JSON.stringify(
        paystackEvent('transfer.success', `${randomUUID()}_${BADGE_KEY}`, 'success'),
      );

      // When
      const response = await postWebhook(world, raw, paystackHeaders(raw));

      // Then
      // 2xx on purpose: a non-2xx makes Paystack redeliver forever an event that
      // is not ours to act on.
      expect(response.status).toBe(200);
      expect(await readPaystackReceipts(world)).toEqual([]);
    });
  });

  describe('Scenario: a signed delivery names a payout this system issued', () => {
    it('Given a pending payout minted through the ingest path, When a transfer.success for its reference is posted correctly signed, Then a receipt keyed by event, reference and status is recorded', async () => {
      // Given
      const payout = await givenPendingPayout(world);
      const raw = JSON.stringify(
        paystackEvent('transfer.success', payout.provider_reference, 'success'),
      );

      // When
      const response = await postWebhook(world, raw, paystackHeaders(raw));

      // Then
      expect(response.status).toBe(200);
      expect(await readPaystackReceipts(world)).toEqual([
        `paystack:transfer.success:${DEMO_USER_ID}_${BADGE_KEY}:success`,
      ]);
    });
  });

  describe('Scenario: Paystack redelivers the same event', () => {
    it('Given a pending payout minted through the ingest path, When the identical signed delivery arrives twice, Then exactly one receipt exists', async () => {
      // Given
      const payout = await givenPendingPayout(world);
      const raw = JSON.stringify(
        paystackEvent('transfer.success', payout.provider_reference, 'success'),
      );

      // When
      const first = await postWebhook(world, raw, paystackHeaders(raw));
      const second = await postWebhook(world, raw, paystackHeaders(raw));

      // Then
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await readPaystackReceipts(world)).toEqual([
        `paystack:transfer.success:${DEMO_USER_ID}_${BADGE_KEY}:success`,
      ]);
    });
  });

  describe('Scenario: a signed delivery is not a transfer outcome', () => {
    it('Given a charge.success carrying a real payout reference, When it is posted correctly signed, Then it is answered 2xx and no receipt is recorded', async () => {
      // Given
      // A real payout's reference, so the only reason to ignore this delivery is
      // the event type — not a reference the system fails to recognise.
      const payout = await givenPendingPayout(world);
      const raw = JSON.stringify(
        paystackEvent('charge.success', payout.provider_reference, 'success'),
      );

      // When
      const response = await postWebhook(world, raw, paystackHeaders(raw));

      // Then
      expect(response.status).toBe(200);
      expect(await readPaystackReceipts(world)).toEqual([]);
    });
  });

  describe('Scenario: a delivery lands after the payout has already settled', () => {
    it('Given a payout the worker already transferred, When a transfer.success for it is posted correctly signed, Then the receipt is written but no second transfer is bought', async () => {
      // Given
      const settled = await givenSucceededPayout(world);
      expect(settled.status).toBe('succeeded');
      const transfersBefore = world.provider.attempted.length;
      const raw = JSON.stringify(
        paystackEvent('transfer.success', settled.provider_reference, 'success'),
      );

      // When
      const response = await postWebhook(world, raw, paystackHeaders(raw));
      expect(response.status).toBe(200);
      // If the handler did re-enqueue, the job exists by now; wait it out so the
      // assertions below see whatever it would have done.
      await drainPayoutQueue(world, 60_000);

      // Then
      // The receipt is still written — the delivery was processed, it simply had
      // nothing left to do.
      expect(await readPaystackReceipts(world)).toEqual([
        `paystack:transfer.success:${DEMO_USER_ID}_${BADGE_KEY}:success`,
      ]);
      const after = await readPayoutFor(world, DEMO_USER_ID, BADGE_KEY);
      expect(after.status).toBe(settled.status);
      expect(after.attempts).toBe(settled.attempts);
      // The money assertion: a late webhook must never buy a second transfer.
      expect(world.provider.attempted).toHaveLength(transfersBefore);
    });
  });
});
