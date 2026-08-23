import { Module } from '@nestjs/common';
import { AchievementsModule } from '../../src/modules/achievements/achievements.module';
import { CoreModule } from '../../src/core.module';
import { EvaluateProcessor } from '../../src/modules/events/evaluate.processor';
import { EventsModule } from '../../src/modules/events/events.module';
import { PayoutSweeperService } from '../../src/modules/payouts/payout-sweeper.service';
import { PayoutProcessor } from '../../src/modules/payouts/payout.processor';
import { PayoutsModule } from '../../src/modules/payouts/payouts.module';

/**
 * Both module graphs in one process.
 *
 * Production splits producers (api) from consumers (worker); an integration test
 * that posts an event and waits for the job needs both, or it would enqueue work
 * nothing ever consumes and hang. ScheduleModule is deliberately absent so the
 * sweeper only runs when a test calls it.
 */
@Module({
  imports: [CoreModule, AchievementsModule, EventsModule, PayoutsModule],
  providers: [EvaluateProcessor, PayoutProcessor, PayoutSweeperService],
})
export class TestAppModule {}
