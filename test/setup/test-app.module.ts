import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ResponseSchemaInterceptor } from '../../src/common/interceptors/response-schema.interceptor';
import { AchievementsModule } from '../../src/modules/achievements/achievements.module';
import { CoreModule } from '../../src/core.module';
import { EvaluateProcessor } from '../../src/modules/events/evaluate.processor';
import { EventsModule } from '../../src/modules/events/events.module';
import { HealthModule } from '../../src/modules/health/health.module';
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
 *
 * `HealthModule` is included so this graph offers the same HTTP surface as the
 * api role. Without it the OpenAPI completeness gate
 * (`test/bdd/foundation/openapi.bdd-spec.ts`) cannot see the health routes, and
 * an undocumented health endpoint would pass unnoticed.
 */
@Module({
  imports: [CoreModule, AchievementsModule, EventsModule, HealthModule, PayoutsModule],
  providers: [
    EvaluateProcessor,
    PayoutProcessor,
    PayoutSweeperService,
    // Mirrors AppModule, so the BDD tier exercises the same response projection
    // production applies.
    { provide: APP_INTERCEPTOR, useClass: ResponseSchemaInterceptor },
  ],
})
export class TestAppModule {}
