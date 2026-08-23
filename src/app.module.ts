import { Module } from '@nestjs/common';
import { AchievementsModule } from './modules/achievements/achievements.module';
import { CoreModule } from './core.module';
import { EventsModule } from './modules/events/events.module';

/**
 * The HTTP role. Deliberately excludes the queue processors: the API cannot
 * consume a job because the processor classes are not in its module graph, so a
 * hung provider call can never reach the request event loop.
 */
@Module({ imports: [CoreModule, AchievementsModule, EventsModule] })
export class AppModule {}
