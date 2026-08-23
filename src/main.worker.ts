import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // Lets an in-flight payout finish on SIGTERM rather than being killed mid-transfer.
  app.enableShutdownHooks();
  Logger.log('worker started: evaluate + payout processors, sweeper', 'Bootstrap');
}

void bootstrap();
