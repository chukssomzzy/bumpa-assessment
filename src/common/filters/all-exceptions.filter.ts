import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

/** The envelope every error response is shaped into. `errors` is omitted, not null, when there is no structured detail. */
interface ErrorEnvelope {
  success: false;
  statusCode: number;
  message: string;
  errors?: unknown;
}

/**
 * Catches everything that reaches Nest unhandled and shapes it into one error
 * envelope, regardless of adapter (hence `HttpAdapterHost` rather than
 * `@Res()` or a hardcoded Express response).
 *
 * Deliberately does not touch success responses: the achievements endpoint's
 * shape is a graded contract and must stay raw.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.adapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();

    const envelope = this.toEnvelope(exception);

    // 4xx are expected traffic (bad input, auth failures); only a genuine
    // fault (5xx, including anything that was not an HttpException at all)
    // is worth an error-level log line.
    if (envelope.statusCode >= 500) {
      this.logger.error(
        `${envelope.statusCode} ${httpAdapter.getRequestMethod(request)} ${httpAdapter.getRequestUrl(request)}: ${envelope.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    httpAdapter.reply(ctx.getResponse(), envelope, envelope.statusCode);
  }

  private toEnvelope(exception: unknown): ErrorEnvelope {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        return { success: false, statusCode, message: body };
      }

      // Nest's built-in exceptions (and class-validator's) shape the body as
      // `{ message, error, statusCode }`; `message` can itself be an array of
      // per-field errors, which becomes the structured `errors` detail. The
      // plain-string-message case (the overwhelming majority: NotFound,
      // Unauthorized, etc.) deliberately gets no `errors` key at all.
      if (typeof body === 'object' && body !== null) {
        const { message, error } = body as { message?: unknown; error?: unknown };
        const summary =
          typeof message === 'string'
            ? message
            : typeof error === 'string'
              ? error
              : exception.message;
        return {
          success: false,
          statusCode,
          message: summary,
          ...(Array.isArray(message) ? { errors: message } : {}),
        };
      }

      return { success: false, statusCode, message: exception.message };
    }

    // Anything else is a bug, not an expected failure: never echo its message
    // or stack to the client, only to the error log above.
    return {
      success: false,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }
}
