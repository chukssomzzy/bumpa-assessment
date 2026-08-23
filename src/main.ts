import { NestFactory } from '@nestjs/core';
import { ConfigType } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { appConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  // rawBody: the HMAC is computed over the exact bytes received, not over a
  // re-serialised object.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableShutdownHooks();

  const config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  await app.listen(config.port ?? 3000);
  Logger.log(`api listening on ${config.port ?? 3000}`, 'Bootstrap');
}

void bootstrap();
