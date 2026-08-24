import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AchievementsModule } from '../achievements/achievements.module';
import { EVALUATE_QUEUE } from '../../common/queues';
import { EVALUATE_JOB_OPTIONS } from '../../common/queue.constants';
import { PayoutsModule } from '../payouts/payouts.module';
import { UsersModule } from '../users/users.module';
import { BadgeUnlockedListener } from './badge-unlocked.listener';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { HmacGuard } from './hmac.guard';

/**
 * Re-exports `UsersModule` rather than just importing it: `EvaluateProcessor`
 * (provided directly in `WorkerModule`, alongside the api+worker combined
 * `TestAppModule`) needs `UserRepository` and neither of those module graphs
 * imports `UsersModule` itself.
 */
@Module({
  imports: [
    UsersModule,
    AchievementsModule,
    PayoutsModule,
    BullModule.registerQueue({ name: EVALUATE_QUEUE, defaultJobOptions: EVALUATE_JOB_OPTIONS }),
  ],
  controllers: [EventsController],
  providers: [EventsService, HmacGuard, BadgeUnlockedListener],
  exports: [EventsService, UsersModule, BullModule],
})
export class EventsModule {}
