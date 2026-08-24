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

describe('verifyHmac', () => {
  it('accepts a request signed under its own scheme', () => {
    expect(verifyHmac(storefront, signedForStorefront(), NOW)).toBe(true);
    expect(verifyHmac(paystack, signedForPaystack(), NOW)).toBe(true);
  });

  // The whole point of parameterising the guard: two senders share a service
  // and must not be interchangeable, even holding the same secret.
  it('rejects a storefront-signed request under the paystack scheme', () => {
    expect(verifyHmac(paystack, signedForStorefront(), NOW)).toBe(false);
  });

  it('rejects a paystack-signed request under the storefront scheme', () => {
    expect(verifyHmac(storefront, signedForPaystack(), NOW)).toBe(false);
  });

  it('fails closed when no secret is configured', () => {
    const unconfigured: HmacScheme = { ...paystack, secret: undefined };
    // Signed with the empty-key digest an attacker could compute unaided.
    const forged = request({ 'x-paystack-signature': hmacDigest(paystack, BODY) });

    expect(verifyHmac(unconfigured, forged, NOW)).toBe(false);
  });

  it('rejects a tampered body', () => {
    const signed = signedForPaystack();
    signed.rawBody = Buffer.from(JSON.stringify({ event: 'transfer.failed' }));

    expect(verifyHmac(paystack, signed, NOW)).toBe(false);
  });

  it('rejects a missing or non-hex signature', () => {
    expect(verifyHmac(paystack, request({}), NOW)).toBe(false);
    expect(verifyHmac(paystack, request({ 'x-paystack-signature': 'not-hex!' }), NOW)).toBe(false);
  });

  it('rejects an absent raw body rather than signing over nothing', () => {
    const headers = { 'x-paystack-signature': hmacDigest(paystack, BODY) };
    expect(verifyHmac(paystack, request(headers, null), NOW)).toBe(false);
  });

  describe('timestamp binding', () => {
    it('rejects a timestamp outside the tolerance window', () => {
      const stale = signedForStorefront(BODY, NOW - 301);
      expect(verifyHmac(storefront, stale, NOW)).toBe(false);
    });

    it('accepts skew in either direction within tolerance', () => {
      expect(verifyHmac(storefront, signedForStorefront(BODY, NOW - 299), NOW)).toBe(true);
      expect(verifyHmac(storefront, signedForStorefront(BODY, NOW + 299), NOW)).toBe(true);
    });

    // Rewriting x-timestamp must invalidate the signature; otherwise the
    // freshness window is unauthenticated and replay is unbounded.
    it('rejects a replay that rewrites the timestamp header', () => {
      const captured = signedForStorefront(BODY, NOW - 10_000);
      const replayed = request(
        { 'x-signature': captured.header('x-signature'), 'x-timestamp': String(NOW) },
        BODY,
      );

      expect(verifyHmac(storefront, replayed, NOW)).toBe(false);
    });

    it('ignores timestamp headers entirely when the scheme does not bind one', () => {
      const signed = signedForPaystack();
      const withNoise = request(
        { 'x-paystack-signature': signed.header('x-paystack-signature'), 'x-timestamp': '1' },
        BODY,
      );

      expect(verifyHmac(paystack, withNoise, NOW)).toBe(true);
    });
  });
});
