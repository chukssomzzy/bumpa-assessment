import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { paymentsConfig } from '../config/configuration';
import { FakePaymentProvider } from './fake.provider';
import { PaymentProvider } from './payment-provider';
import { PaystackProvider } from './paystack.provider';

@Module({
  providers: [
    FakePaymentProvider,
    PaystackProvider,
    {
      provide: PaymentProvider,
      inject: [paymentsConfig.KEY, FakePaymentProvider, PaystackProvider],
      useFactory: (
        config: ConfigType<typeof paymentsConfig>,
        fake: FakePaymentProvider,
        paystack: PaystackProvider,
      ) => (config.provider === 'paystack' ? paystack : fake),
    },
  ],
  exports: [PaymentProvider, FakePaymentProvider],
})
export class PaymentsModule {}
