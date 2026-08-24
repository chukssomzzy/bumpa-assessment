import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { Observable, map } from 'rxjs';
import { ZodObject, type ZodType } from 'zod';
import { RESPONSE_SCHEMA } from '../decorators/response-schema.decorator';

/**
 * Enforces the declared response shape on handlers carrying `@ResponseSchema`.
 *
 * **Strips rather than rejects.** A response that carries an unexpected field is
 * a bug, but it is not a reason to fail a request that otherwise computed the
 * right answer — turning cosmetic drift into a 500 would make a leak and an
 * outage the same event. So the payload is projected onto the declared keys and
 * sent; the client can never receive something the contract did not promise.
 *
 * The obvious cost of stripping is that it hides the bug it just prevented, so
 * a mismatch is logged at `error` with the offending keys. Silent correction is
 * what makes this pattern dangerous; the log is what makes it safe.
 *
 * Handlers without the decorator pass through untouched — this is opt-in, not a
 * global envelope. Success payloads are deliberately never wrapped.
 */
@Injectable()
export class ResponseSchemaInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly logger: PinoLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schema = this.reflector.getAllAndOverride<ZodType | undefined>(RESPONSE_SCHEMA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!schema) return next.handle();

    const route = `${context.getClass().name}.${context.getHandler().name}`;

    return next.handle().pipe(
      map((payload: unknown) => {
        const result = schema.safeParse(payload);

        if (!result.success) {
          // Loud, because the alternative to a 500 is a log nobody reads.
          this.logger.error(
            {
              route,
              issues: result.error.issues.map(
                (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
              ),
            },
            'response did not match its declared schema; sending the declared keys only',
          );
          return this.project(schema, payload);
        }

        // zod strips unknown keys on a plain object schema, so this IS the
        // projection for the success path — but it does so SILENTLY: a payload
        // carrying an extra field parses successfully, which is exactly the
        // leak case and exactly the case worth knowing about. Detect it by
        // comparing key sets, because `safeParse` will never report it.
        const leaked = this.extraKeys(schema, payload);
        if (leaked.length > 0) {
          this.logger.error(
            { route, leaked },
            'response carried fields its contract does not declare; they were stripped',
          );
        }

        return result.data;
      }),
    );
  }

  /** Keys present on the payload that the contract never declared. */
  private extraKeys(schema: ZodType, payload: unknown): string[] {
    if (!(schema instanceof ZodObject) || typeof payload !== 'object' || payload === null) {
      return [];
    }
    const declared = new Set(Object.keys(schema.shape as Record<string, unknown>));
    return Object.keys(payload as Record<string, unknown>).filter((key) => !declared.has(key));
  }

  /**
   * Best-effort projection for a payload that failed validation.
   *
   * Never throws: the request already succeeded, and this runs after the
   * handler. Returning the declared keys — even if some are missing — is
   * strictly safer than passing the raw payload through, which is exactly the
   * leak this interceptor exists to prevent.
   */
  private project(schema: ZodType, payload: unknown): unknown {
    if (!(schema instanceof ZodObject) || typeof payload !== 'object' || payload === null) {
      return payload;
    }
    const source = payload as Record<string, unknown>;
    const declared = Object.keys(schema.shape as Record<string, unknown>);
    return Object.fromEntries(
      declared.filter((key) => key in source).map((key) => [key, source[key]]),
    );
  }
}
