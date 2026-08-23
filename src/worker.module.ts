import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AchievementsModule } from './modules/achievements/achievements.module';
import { CoreModule } from './core.module';
import { WorkerHeartbeatService } from './common/worker-heartbeat.service';
import { EvaluateProcessor } from './modules/events/evaluate.processor';
import { EventsModule } from './modules/events/events.module';
import { PayoutSweeperService } from './modules/payouts/payout-sweeper.service';
import { PayoutProcessor } from './modules/payouts/payout.processor';
import { PayoutsModule } from './modules/payouts/payouts.module';

/** The background role: both queue processors and the sweeper. No HTTP server. */
@Module({
  imports: [CoreModule, ScheduleModule.forRoot(), AchievementsModule, EventsModule, PayoutsModule],
  providers: [EvaluateProcessor, PayoutProcessor, PayoutSweeperService, WorkerHeartbeatService],
})
export class WorkerModule {}
