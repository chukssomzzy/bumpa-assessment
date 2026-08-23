import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AchievementsModule } from './achievements/achievements.module';
import { CoreModule } from './core.module';
import { EvaluateProcessor } from './events/evaluate.processor';
import { EventsModule } from './events/events.module';
import { PayoutSweeperService } from './payouts/payout-sweeper.service';
import { PayoutProcessor } from './payouts/payout.processor';
import { PayoutsModule } from './payouts/payouts.module';

/** The background role: both queue processors and the sweeper. No HTTP server. */
@Module({
  imports: [CoreModule, ScheduleModule.forRoot(), AchievementsModule, EventsModule, PayoutsModule],
  providers: [EvaluateProcessor, PayoutProcessor, PayoutSweeperService],
})
export class WorkerModule {}
