import { Injectable, PipeTransform, UnprocessableEntityException } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates and narrows a request payload against a zod schema at the HTTP
 * boundary, so services receive data that is already the right shape.
 *
 * This is the seam that lets zod play the role `ValidationPipe` plays for
 * class-validator. Shape checking is a boundary concern: a service asking
 * "is this even a purchase event?" is doing the transport layer's job, and it
 * makes the service's own signature dishonest — it claims to take `unknown`
 * when it only ever handles one shape.
 *
 * Field-level issues are raised as an ARRAY `message`, which
 * `AllExceptionsFilter` promotes to the structured `errors` key, with `error`
 * carrying the human summary. That is the same contract Nest's built-in
 * validation uses, so clients see one error shape regardless of which library
 * produced it.
 *
 * 422 rather than 400 deliberately: the request was well-formed HTTP and its
 * signature verified — what failed is the semantics of the payload.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(
    private readonly schema: ZodType<T>,
    private readonly summary = 'request payload failed validation',
  ) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new UnprocessableEntityException({
      error: this.summary,
      message: result.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    });
  }
}
