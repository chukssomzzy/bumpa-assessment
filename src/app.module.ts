import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AchievementsModule } from './modules/achievements/achievements.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseSchemaInterceptor } from './common/interceptors/response-schema.interceptor';
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
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Opt-in: only handlers carrying `@ResponseSchema` are touched. Registered
    // globally so a route declaring a contract cannot forget to enforce it.
    { provide: APP_INTERCEPTOR, useClass: ResponseSchemaInterceptor },
  ],
})
export class AppModule {}
