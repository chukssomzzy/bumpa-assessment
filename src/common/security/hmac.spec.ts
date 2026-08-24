import { HmacScheme, hmacDigest, verifyHmac } from './hmac';

const SECRET = 'shared-secret';

const storefront: HmacScheme = {
  signatureHeader: 'x-signature',
  secret: SECRET,
  algorithm: 'sha512',
  timestamp: { header: 'x-timestamp', toleranceSeconds: 300 },
};

const paystack: HmacScheme = {
  signatureHeader: 'x-paystack-signature',
  secret: SECRET,
  algorithm: 'sha512',
  timestamp: false,
};

const NOW = 1_700_000_000;
const BODY = JSON.stringify({ event: 'transfer.success' });

/** Builds the minimal request shape the verifier consumes. `null` body means absent. */
const request = (headers: Record<string, string>, body: string | null = BODY) => ({
  header: (name: string) => headers[name],
  rawBody: body === null ? undefined : Buffer.from(body),
});

const signedForStorefront = (body = BODY, timestamp = NOW) =>
  request(
    {
      'x-signature': hmacDigest(storefront, body, String(timestamp)),
      'x-timestamp': String(timestamp),
    },
    body,
  );

const signedForPaystack = (body = BODY) =>
  request({ 'x-paystack-signature': hmacDigest(paystack, body) }, body);

describe('Feature: hmac verification of signed webhook requests', () => {
  describe('Scenario: a request is signed under its own scheme', () => {
    it('accepts the storefront request and the paystack request alike', () => {
      // Given
      const storefrontRequest = signedForStorefront();
      const paystackRequest = signedForPaystack();

      // When
      const storefrontAccepted = verifyHmac(storefront, storefrontRequest, NOW);
      const paystackAccepted = verifyHmac(paystack, paystackRequest, NOW);

      // Then
      expect(storefrontAccepted).toBe(true);
      expect(paystackAccepted).toBe(true);
    });
  });

  // The whole point of parameterising the guard: two senders share a service
  // and must not be interchangeable, even holding the same secret.
  describe('Scenario: a storefront-signed request is presented under the paystack scheme', () => {
    it('rejects the request', () => {
      // Given
      const storefrontRequest = signedForStorefront();

      // When
      const accepted = verifyHmac(paystack, storefrontRequest, NOW);

      // Then
      expect(accepted).toBe(false);
    });
  });

  describe('Scenario: a paystack-signed request is presented under the storefront scheme', () => {
    it('rejects the request', () => {
      // Given
      const paystackRequest = signedForPaystack();

      // When
      const accepted = verifyHmac(storefront, paystackRequest, NOW);

      // Then
      expect(accepted).toBe(false);
    });
  });

  describe('Scenario: the scheme has no secret configured', () => {
    it('fails closed instead of accepting an empty-keyed digest', () => {
      // Given
      const unconfigured: HmacScheme = { ...paystack, secret: undefined };
      // Signed with the empty-key digest an attacker could compute unaided.
      const forged = request({ 'x-paystack-signature': hmacDigest(paystack, BODY) });

      // When
      const accepted = verifyHmac(unconfigured, forged, NOW);

      // Then
      expect(accepted).toBe(false);
    });
  });

  describe('Scenario: the body is altered after it was signed', () => {
    it('rejects the tampered body', () => {
      // Given
      const signed = signedForPaystack();
      signed.rawBody = Buffer.from(JSON.stringify({ event: 'transfer.failed' }));

      // When
      const accepted = verifyHmac(paystack, signed, NOW);

      // Then
      expect(accepted).toBe(false);
    });
  });

  describe('Scenario: the signature header is missing or not hexadecimal', () => {
    it('rejects the request in either case', () => {
      // Given
      const unsigned = request({});
      const malformed = request({ 'x-paystack-signature': 'not-hex!' });

      // When
      const unsignedAccepted = verifyHmac(paystack, unsigned, NOW);
      const malformedAccepted = verifyHmac(paystack, malformed, NOW);

      // Then
      expect(unsignedAccepted).toBe(false);
      expect(malformedAccepted).toBe(false);
    });
  });

  describe('Scenario: the raw body never reached the verifier', () => {
    it('rejects the request rather than signing over nothing', () => {
      // Given
      const headers = { 'x-paystack-signature': hmacDigest(paystack, BODY) };
      const bodyless = request(headers, null);

      // When
      const accepted = verifyHmac(paystack, bodyless, NOW);

      // Then
      expect(accepted).toBe(false);
    });
  });

  describe('Scenario: a bound timestamp falls outside the tolerance window', () => {
    it('rejects the stale request', () => {
      // Given
      const stale = signedForStorefront(BODY, NOW - 301);

      // When
      const accepted = verifyHmac(storefront, stale, NOW);

      // Then
      expect(accepted).toBe(false);
    });
  });

  describe('Scenario: a bound timestamp is skewed but still within tolerance', () => {
    it('accepts skew in either direction', () => {
      // Given
      const behind = signedForStorefront(BODY, NOW - 299);
      const ahead = signedForStorefront(BODY, NOW + 299);

      // When
      const behindAccepted = verifyHmac(storefront, behind, NOW);
      const aheadAccepted = verifyHmac(storefront, ahead, NOW);

      // Then
      expect(behindAccepted).toBe(true);
      expect(aheadAccepted).toBe(true);
    });
  });

  // Rewriting x-timestamp must invalidate the signature; otherwise the
  // freshness window is unauthenticated and replay is unbounded.
  describe('Scenario: a captured request is replayed with a rewritten timestamp header', () => {
    it('rejects the replay', () => {
      // Given
      const captured = signedForStorefront(BODY, NOW - 10_000);
      const replayed = request(
        { 'x-signature': captured.header('x-signature'), 'x-timestamp': String(NOW) },
        BODY,
      );

      // When
      const accepted = verifyHmac(storefront, replayed, NOW);

      // Then
      expect(accepted).toBe(false);
    });
  });

  describe('Scenario: the scheme binds no timestamp at all', () => {
    it('ignores timestamp headers entirely', () => {
      // Given
      const signed = signedForPaystack();
      const withNoise = request(
        { 'x-paystack-signature': signed.header('x-paystack-signature'), 'x-timestamp': '1' },
        BODY,
      );

      // When
      const accepted = verifyHmac(paystack, withNoise, NOW);

      // Then
      expect(accepted).toBe(true);
    });
  });
});
