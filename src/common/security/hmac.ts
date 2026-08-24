import { createHmac, timingSafeEqual } from 'node:crypto';

const HEX_PATTERN = /^[0-9a-f]+$/i;

/** Binds a freshness window into the signature. Omit when the sender signs the body alone. */
export interface HmacTimestampBinding {
  /** Header carrying the unix-seconds timestamp. */
  header: string;
  /** Maximum accepted clock skew, in seconds. */
  toleranceSeconds: number;
}

/**
 * Describes one sender's signing convention.
 *
 * Two senders reach this service and they do NOT agree: the storefront signs
 * `{timestamp}.{rawBody}` and sends `x-signature` + `x-timestamp`; Paystack
 * signs the raw body alone and sends `x-paystack-signature`, because it emits
 * no timestamp header at all. Encoding that difference as data rather than as
 * two near-identical guards is what keeps one verified implementation of the
 * comparison itself.
 */
export interface HmacScheme {
  signatureHeader: string;
  /**
   * Optional on purpose. A scheme whose secret is absent is an incompletely
   * configured sender, and `verifyHmac` treats it as never verifying — see the
   * fail-closed note there.
   */
  secret: string | undefined;
  algorithm: string;
  timestamp: HmacTimestampBinding | false;
}

/** The subset of an incoming request the verifier needs, so it stays free of Express and Nest. */
export interface SignedRequest {
  header(name: string): string | undefined;
  /** Optional to match Express's `RawBodyRequest`; absence fails verification. */
  rawBody?: Buffer;
}

/**
 * Produces the expected hex digest. Exported so tests and the e2e harness sign
 * exactly the way the guard verifies, rather than reimplementing the convention
 * and drifting from it.
 */
export function hmacDigest(
  scheme: HmacScheme,
  rawBody: Buffer | string,
  timestampHeader?: string,
): string {
  if (!scheme.secret) {
    throw new Error(`cannot sign for ${scheme.signatureHeader}: no secret configured`);
  }
  const mac = createHmac(scheme.algorithm, scheme.secret);
  if (scheme.timestamp) {
    if (timestampHeader === undefined) {
      throw new Error(`scheme ${scheme.signatureHeader} binds a timestamp but none was given`);
    }
    mac.update(`${timestampHeader}.`);
  }
  return mac.update(rawBody).digest('hex');
}

/**
 * Verifies a signed request against one scheme. Returns a boolean rather than
 * throwing, so the caller owns the HTTP shape of the rejection.
 *
 * Fails closed on incomplete configuration. A missing secret returns false
 * instead of signing with `undefined` — otherwise booting without a Paystack
 * key would leave the reconcile endpoint accepting whatever an attacker could
 * derive from an empty-keyed HMAC, which is a money boundary open by omission.
 */
export function verifyHmac(
  scheme: HmacScheme,
  request: SignedRequest,
  nowSeconds: number,
): boolean {
  if (!scheme.secret) return false;

  const signature = request.header(scheme.signatureHeader);
  if (!signature || !HEX_PATTERN.test(signature)) return false;

  let timestampHeader: string | undefined;
  if (scheme.timestamp) {
    timestampHeader = request.header(scheme.timestamp.header);
    if (!timestampHeader) return false;

    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp)) return false;
    if (Math.abs(nowSeconds - timestamp) > scheme.timestamp.toleranceSeconds) return false;
  }

  const rawBody = request.rawBody;
  if (!rawBody) return false;

  const expectedBuffer = Buffer.from(hmacDigest(scheme, rawBody, timestampHeader), 'hex');
  const providedBuffer = Buffer.from(signature, 'hex');
  // timingSafeEqual throws on unequal lengths rather than returning false, so
  // the length check must come first and must not leak timing either way.
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}
