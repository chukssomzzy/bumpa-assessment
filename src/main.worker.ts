import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  // bufferLogs: pino replaces the Nest logger below, so boot-time log lines
  // are held until it is ready rather than lost.
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // Lets an in-flight payout finish on SIGTERM rather than being killed mid-transfer.
  app.enableShutdownHooks();
  app.get(Logger).log('worker started: evaluate + payout processors, sweeper', 'Bootstrap');
}

void bootstrap();
