import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { allConfig, databaseConfig, redisConfig } from './config/configuration';
import { entities, migrations } from './database/data-source';

/** Config, database and queue connections shared by both runtime roles. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: allConfig, cache: true }),
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
      useFactory: (config: ConfigType<typeof redisConfig>) => ({
        connection: { url: config.url },
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential' as const, delay: 1000 },
          removeOnComplete: 1000,
          removeOnFail: false,
        },
      }),
    }),
  ],
})
export class CoreModule {}
