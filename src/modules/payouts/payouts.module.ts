import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clock, SystemClock } from '../../common/clock';
import { PAYOUT_QUEUE } from '../../common/queues';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { PayoutEntity } from './payout.entity';
import { PayoutsService } from './payouts.service';

@Module({
  imports: [
    UsersModule,
    PaymentsModule,
    TypeOrmModule.forFeature([PayoutEntity]),
    BullModule.registerQueue({ name: PAYOUT_QUEUE }),
  ],
  providers: [PayoutsService, { provide: Clock, useClass: SystemClock }],
  exports: [PayoutsService, BullModule, TypeOrmModule],
})
export class PayoutsModule {}
