import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { appConfig } from '../../config/configuration';

/** Docker probes these constantly; excluded from request logging so they cannot flood it. */
const UNLOGGED_PATHS = new Set(['/health', '/health/ready']);

/**
 * `pino-pretty` is a devDependency: the production image installs with
 * `--omit=dev` and never has it on disk. Resolving it at runtime, rather than
 * assuming it exists whenever `NODE_ENV=development`, is what keeps a
 * misconfigured production boot (env file with the wrong NODE_ENV, as the
 * compose default actually is) from crashing instead of just logging JSON.
 */
function prettyTransportAvailable(): boolean {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const header = req.headers['x-request-id'];
  const id = typeof header === 'string' && header.length > 0 ? header : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

/**
 * Structured logging shared by both runtime roles. Global (nestjs-pino marks
 * `LoggerModule` `@Global()`), so importing it once from `CoreModule` makes
 * `Logger`/`PinoLogger` injectable everywhere in either module graph,
 * including the worker's processors — nothing here is HTTP-specific except
 * the request middleware itself, which only binds when there is an HTTP
 * adapter to bind it to.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (config: ConfigType<typeof appConfig>) => ({
        pinoHttp: {
          genReqId,
          autoLogging: { ignore: (req: IncomingMessage) => UNLOGGED_PATHS.has(req.url ?? '') },
          // The HMAC signature is a secret over the body, not a value to echo
          // into logs; authorization/cookie are the standard baseline.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-signature"]',
            ],
            censor: '[redacted]',
          },
          transport:
            config.nodeEnv === 'development' && prettyTransportAvailable()
              ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
              : undefined,
        },
      }),
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
