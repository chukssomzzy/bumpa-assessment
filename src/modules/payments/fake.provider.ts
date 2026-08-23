import { Injectable } from '@nestjs/common';
import type { UserEntity } from '../users/user.entity';
import { PaymentProvider, type TransferRequest, type TransferResult } from './payment-provider';

/**
 * In-memory provider. Scriptable so tests can inject success, hard failure and
 * ambiguous timeouts without touching the network.
 */
@Injectable()
export class FakePaymentProvider extends PaymentProvider {
  private readonly transfers = new Map<string, TransferResult>();
  private readonly recipients = new Map<string, string>();

  /** Queued outcomes, consumed one per transfer call. Defaults to success. */
  private scripted: TransferResult[] = [];
  private recipientFailure: Error | null = null;

  script(...results: TransferResult[]): void {
    this.scripted.push(...results);
  }

  failRecipientResolution(error: Error): void {
    this.recipientFailure = error;
  }

  reset(): void {
    this.transfers.clear();
    this.recipients.clear();
    this.scripted = [];
    this.recipientFailure = null;
  }

  /** Every transfer the provider was asked to make, in order. */
  get attempted(): TransferRequest[] {
    return [...this.requests];
  }
  private readonly requests: TransferRequest[] = [];

  async ensureRecipient(user: UserEntity): Promise<string> {
    if (this.recipientFailure) throw this.recipientFailure;
    const existing = this.recipients.get(user.id);
    if (existing) return existing;
    const code = `RCP_fake_${user.id.slice(0, 8)}`;
    this.recipients.set(user.id, code);
    return code;
  }

  async transfer(request: TransferRequest): Promise<TransferResult> {
    this.requests.push(request);
    const scripted = this.scripted.shift();
    const result: TransferResult = scripted ?? {
      status: 'succeeded',
      reference: request.reference,
    };
    // An unknown outcome may still have moved money: record it so a later
    // reconciliation can discover the truth, exactly as a real provider would.
    if (result.status !== 'failed') {
      this.transfers.set(request.reference, {
        status: 'succeeded',
        reference: request.reference,
      });
    }
    return result;
  }

  async findTransfer(reference: string): Promise<TransferResult | null> {
    return this.transfers.get(reference) ?? null;
  }
}
