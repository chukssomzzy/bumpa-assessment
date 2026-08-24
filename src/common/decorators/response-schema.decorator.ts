import { SetMetadata } from '@nestjs/common';
import type { ZodType } from 'zod';

export const RESPONSE_SCHEMA = 'response-schema';

/**
 * Declares the shape a handler is allowed to return.
 *
 * `ResponseSchemaInterceptor` projects the payload onto exactly these keys, so
 * a field the contract never promised cannot reach a client even if a future
 * refactor starts spreading an entity into the response.
 */
export const ResponseSchema = (schema: ZodType) => SetMetadata(RESPONSE_SCHEMA, schema);
