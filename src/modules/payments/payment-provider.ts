import type { UserEntity } from '../users/user.entity';

/** Outcome of a transfer attempt. */
export type TransferResult =
  | { status: 'succeeded'; reference: string }
  /** The provider rejected it. Retrying may help (`retryable`) or never will. */
  | { status: 'failed'; reason: string; retryable: boolean }
  /**
   * The call did not complete cleanly, so whether money moved is unknown. The
   * caller must reconcile by reference before attempting another transfer.
   */
  | { status: 'unknown'; reason: string };

export interface TransferRequest {
  recipientCode: string;
  amountKobo: number;
  /** Idempotency key. Also how an ambiguous outcome is later reconciled. */
  reference: string;
}

/**
 * The outbound money boundary.
 *
 * Implemented for real by Paystack and in memory by the fake used in tests, so
 * the whole suite runs offline while the real adapter stays exercisable.
 */
export abstract class PaymentProvider {
  /** Resolves a transfer recipient for the user, creating one if needed. */
  abstract ensureRecipient(user: UserEntity): Promise<string>;

  abstract transfer(request: TransferRequest): Promise<TransferResult>;

  /** Looks up a previous transfer by reference. Used after an unknown outcome. */
  abstract findTransfer(reference: string): Promise<TransferResult | null>;
}
