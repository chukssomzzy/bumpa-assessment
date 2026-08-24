import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { Clock, SystemClock } from '../../common/clock';
import { PAYOUT_QUEUE } from '../../common/queues';
import { PAYOUT_JOB_OPTIONS } from '../../common/queue.constants';
import { PaymentsModule } from '../payments/payments.module';
import { ProcessedEventRepository } from '../events/repositories/processed-event.repository';
import { UsersModule } from '../users/users.module';
import { PayoutWebhookController } from './payout-webhook.controller';
import { PayoutWebhookService } from './payout-webhook.service';
import { PayoutsService } from './payouts.service';
import { PaystackSignatureGuard } from './paystack-signature.guard';
import { PayoutRepository } from './repositories/payout.repository';

/**
 * The webhook controller lives here rather than in `payments`, even though it
 * speaks a provider's dialect: `PayoutsModule` already imports `PaymentsModule`,
 * so the reverse dependency would be a cycle needing `forwardRef`. What the
 * endpoint actually does — re-drive a payout — is this module's concern anyway.
 *
 * `ProcessedEventRepository` is provided here as well as in `AchievementsModule`
 * (and would be in `EventsModule` if it needed one). That is a provider
 * registration, not a module import, so it creates no cycle back to
 * `EventsModule` (which itself imports this one).
 */
@Module({
  imports: [
    UsersModule,
    PaymentsModule,
    BullModule.registerQueue({ name: PAYOUT_QUEUE, defaultJobOptions: PAYOUT_JOB_OPTIONS }),
  ],
  controllers: [PayoutWebhookController],
  providers: [
    PayoutsService,
    PayoutWebhookService,
    PaystackSignatureGuard,
    PayoutRepository,
    ProcessedEventRepository,
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [PayoutsService, PayoutWebhookService, PayoutRepository, BullModule],
})
export class PayoutsModule {}
