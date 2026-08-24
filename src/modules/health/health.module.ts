import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { HealthController } from './health.controller';
import { HealthRepository } from './repositories/health.repository';

/**
 * API-only (see `AppModule`): the worker has no HTTP listener to probe.
 * Imports `EventsModule` rather than registering its own queue purely to read
 * the evaluate queue's Redis connection — `EventsModule` already exports the
 * `BullModule` registration that owns it.
 */
@Module({
  imports: [EventsModule],
  controllers: [HealthController],
  providers: [HealthRepository],
})
export class HealthModule {}
