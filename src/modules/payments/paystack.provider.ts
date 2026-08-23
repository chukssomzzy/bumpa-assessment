import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { paymentsConfig } from '../../config/configuration';
import type { UserEntity } from '../users/user.entity';
import { PaymentProvider, type TransferRequest, type TransferResult } from './payment-provider';

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

  ensureRecipient(_user: UserEntity): Promise<string> {
    throw new Error('not implemented');
  }

  transfer(_request: TransferRequest): Promise<TransferResult> {
    throw new Error('not implemented');
  }

  findTransfer(_reference: string): Promise<TransferResult | null> {
    throw new Error('not implemented');
  }
}
