import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AchievementsModule } from '../achievements/achievements.module';
import { EVALUATE_QUEUE } from '../../common/queues';
import { PayoutsModule } from '../payouts/payouts.module';
import { UsersModule } from '../users/users.module';
import { BadgeUnlockedListener } from './badge-unlocked.listener';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { HmacGuard } from './hmac.guard';
import { ProcessedEventEntity } from './processed-event.entity';

@Module({
  imports: [
    UsersModule,
    AchievementsModule,
    PayoutsModule,
    TypeOrmModule.forFeature([ProcessedEventEntity]),
    BullModule.registerQueue({ name: EVALUATE_QUEUE }),
  ],
  controllers: [EventsController],
  providers: [EventsService, HmacGuard, BadgeUnlockedListener],
  exports: [EventsService, BullModule],
})
export class EventsModule {}
