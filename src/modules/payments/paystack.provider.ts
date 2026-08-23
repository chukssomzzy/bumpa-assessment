import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { paymentsConfig } from '../../config/configuration';
import type { UserEntity } from '../users/user.entity';
import { PaymentProvider, type TransferRequest, type TransferResult } from './payment-provider';

const REQUEST_TIMEOUT_MS = 10_000;

interface PaystackEnvelope<T> {
  status?: boolean;
  message?: string;
  data?: T;
}

interface RecipientData {
  recipient_code?: string;
}

interface TransferData {
  status?: string;
  reference?: string;
}

const isEnvelope = (value: unknown): value is PaystackEnvelope<unknown> =>
  typeof value === 'object' && value !== null;

/** Statuses Paystack reports for a completed transfer. */
const SUCCESS_TRANSFER_STATUSES = new Set(['success']);
/** A reversal is definitive: the funds are back, so retrying can never help. */
const FAILED_TRANSFER_STATUSES = new Set(['failed', 'reversed']);
/**
 * Still in flight on Paystack's side (e.g. awaiting OTP confirmation). Not a
 * terminal outcome, but also not a lost call — mapped to `unknown` (the port
 * has no third state) with a `reason` that says so, so the caller reconciles
 * again rather than reading it as a dropped network call.
 *
 * A production deployment would settle these via Paystack's transfer
 * webhook instead of polling `findTransfer`; this mapping is the fallback
 * for when that webhook hasn't landed yet.
 */
const PENDING_TRANSFER_STATUSES = new Set(['pending', 'otp']);

/**
 * Paystack adapter.
 *
 * Test-mode transfers succeed immediately without moving funds, so this path is
 * exercisable end to end against test keys. No assumption is made about
 * provider-side idempotency: an unknown outcome is reconciled by explicit lookup.
 */
@Injectable()
export class PaystackProvider extends PaymentProvider {
  private readonly logger = new Logger(PaystackProvider.name);

  constructor(
    @Inject(paymentsConfig.KEY)
    private readonly config: ConfigType<typeof paymentsConfig>,
  ) {
    super();
  }

  async ensureRecipient(user: UserEntity): Promise<string> {
    if (!user.accountNumber || !user.bankCode) {
      throw new Error(`user ${user.id} has no bank account on file`);
    }

    const body = await this.request<RecipientData>('/transferrecipient', {
      type: 'nuban',
      name: user.name,
      account_number: user.accountNumber,
      bank_code: user.bankCode,
      currency: 'NGN',
    });

    const code = body.data?.recipient_code;
    if (!code) {
      throw new Error('paystack did not return a recipient_code');
    }
    return code;
  }

  async transfer(request: TransferRequest): Promise<TransferResult> {
    let res: Response;
    try {
      res = await fetch(this.url('/transfer'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          source: 'balance',
          amount: request.amountKobo,
          recipient: request.recipientCode,
          reference: request.reference,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Network failure or abort: whether the transfer landed is unknowable from
      // here, so it must never be reported as `failed` (that would license a
      // caller to try again and risk paying twice).
      return { status: 'unknown', reason: message(err) };
    }

    if (res.status === 429) {
      return { status: 'failed', reason: 'rate limited', retryable: true };
    }
    if (res.status >= 500) {
      // The gateway itself failed; money may still have moved on Paystack's side.
      return { status: 'unknown', reason: `paystack ${res.status}` };
    }
    if (res.status >= 400) {
      const body = await this.parseBody<TransferData>(res);
      return {
        status: 'failed',
        reason: body?.message ?? `paystack ${res.status}`,
        retryable: false,
      };
    }

    const body = await this.parseBody<TransferData>(res);
    return this.mapTransferStatus(body, request.reference);
  }

  async findTransfer(reference: string): Promise<TransferResult | null> {
    let res: Response;
    try {
      res = await fetch(this.url(`/transfer/verify/${encodeURIComponent(reference)}`), {
        method: 'GET',
        headers: this.headers(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(`transfer lookup failed for ${reference}: ${message(err)}`);
      return { status: 'unknown', reason: message(err) };
    }

    if (res.status === 404) return null;
    if (!res.ok) {
      return { status: 'unknown', reason: `paystack ${res.status}` };
    }

    const body = await this.parseBody<TransferData>(res);
    return this.mapTransferStatus(body, reference);
  }

  /**
   * Maps a Paystack transfer status onto the port's three-state outcome.
   *
   * `succeeded`/`failed` are terminal, so both require `status: true` on the
   * envelope — the same trust bar the pre-existing success check used. An
   * untrustworthy envelope (`status: false`, or missing) must never be read
   * as a definitive `failed` either: that would let a garbled response mark
   * a payout terminally failed the same way an unreconciled attempts-ceiling
   * check could (see `PayoutsService.dispatch`), so it falls to `unknown`
   * instead. `pending`/`otp` fall to `unknown` regardless — they're not
   * terminal on either side of the envelope check.
   */
  private mapTransferStatus(
    body: PaystackEnvelope<TransferData> | null,
    fallbackReference: string,
  ): TransferResult {
    const status = body?.data?.status;
    if (body?.status === true && status && SUCCESS_TRANSFER_STATUSES.has(status)) {
      return { status: 'succeeded', reference: body.data?.reference ?? fallbackReference };
    }
    if (body?.status === true && status && FAILED_TRANSFER_STATUSES.has(status)) {
      return {
        status: 'failed',
        reason: body.message ?? `paystack transfer ${status}`,
        retryable: false,
      };
    }
    if (status && PENDING_TRANSFER_STATUSES.has(status)) {
      return {
        status: 'unknown',
        reason: `paystack transfer ${status}: awaiting provider-side settlement, not a lost call`,
      };
    }
    return { status: 'unknown', reason: body?.message ?? 'unrecognised transfer response' };
  }

  private async request<T>(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<PaystackEnvelope<T>> {
    const res = await fetch(this.url(path), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await this.parseBody<T>(res);
      throw new Error(body?.message ?? `paystack ${path} failed with ${res.status}`);
    }
    const body = await this.parseBody<T>(res);
    if (!body) throw new Error(`paystack ${path} returned an unparseable body`);
    return body;
  }

  private async parseBody<T>(res: Response): Promise<PaystackEnvelope<T> | null> {
    const json: unknown = await res.json().catch(() => null);
    return isEnvelope(json) ? (json as PaystackEnvelope<T>) : null;
  }

  private headers(): Record<string, string> {
    return {
      // The boot-time refine in `paymentsConfig` guarantees this is set whenever
      // `provider === 'paystack'`, which is the only case this class is used.
      Authorization: `Bearer ${this.config.paystackSecretKey ?? ''}`,
      'Content-Type': 'application/json',
    };
  }

  private url(path: string): string {
    return `${this.config.paystackBaseUrl}${path}`;
  }
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
