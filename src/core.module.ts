import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { allConfig, databaseConfig, redisConfig } from './config/configuration';
import { entities, migrations } from './database/data-source';
import { DefinitionsGuard } from './database/definitions.guard';
import { DEFAULT_JOB_OPTIONS } from './common/queue.constants';
import { LoggerModule } from './common/logging/logger.module';

/** Config, database and queue connections shared by both runtime roles. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: allConfig, cache: true }),
    LoggerModule,
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (config: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres' as const,
        url: config.url,
        entities,
        migrations,
        synchronize: false,
      }),
    }),
    BullModule.forRootAsync({
      inject: [redisConfig.KEY],
      // Per-queue options in queue.constants.ts override this per registerQueue()
      // call where a queue's retry semantics need to differ (payout does).
      useFactory: (config: ConfigType<typeof redisConfig>) => ({
        connection: { url: config.url },
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
  ],
  providers: [DefinitionsGuard],
})
export class CoreModule {}
