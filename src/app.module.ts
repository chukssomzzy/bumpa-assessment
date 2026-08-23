import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AchievementsModule } from './modules/achievements/achievements.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { CoreModule } from './core.module';
import { EventsModule } from './modules/events/events.module';
import { HealthModule } from './modules/health/health.module';

/**
 * The HTTP role. Deliberately excludes the queue processors: the API cannot
 * consume a job because the processor classes are not in its module graph, so a
 * hung provider call can never reach the request event loop.
 */
@Module({
  imports: [CoreModule, AchievementsModule, EventsModule, HealthModule],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
