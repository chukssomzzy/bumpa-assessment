import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { ClsModule } from 'nestjs-cls';
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
    // `global: true` so `TransactionHost`/`ClsService` are injectable from any
    // repository in either module graph without per-module wiring. `middleware.mount`
    // gives HTTP requests an ambient CLS context automatically; the worker role never
    // boots an HTTP adapter (`createApplicationContext`, not `create`), so that mount
    // is inert there — queue processors instead open their own context per job with
    // `@UseCls()` (see `evaluate.processor.ts` / `payout.processor.ts`).
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
      plugins: [
        new ClsPluginTransactional({
          adapter: new TransactionalAdapterTypeOrm({ dataSourceToken: getDataSourceToken() }),
        }),
      ],
    }),
  ],
  providers: [DefinitionsGuard],
})
export class CoreModule {}
