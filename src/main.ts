import { NestFactory } from '@nestjs/core';
import { ConfigType } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { appConfig } from './config/configuration';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  // rawBody: the HMAC is computed over the exact bytes received, not over a
  // re-serialised object. bufferLogs: pino replaces the Nest logger below, so
  // boot-time log lines are held until it is ready rather than lost.
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // HTTP role only. `main.worker.ts` has no server to mount a document on.
  setupSwagger(app);

  const config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  await app.listen(config.port ?? 3000);
  app.get(Logger).log(`api listening on ${config.port ?? 3000}; docs at /docs`, 'Bootstrap');
}

void bootstrap();
