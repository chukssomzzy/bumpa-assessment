import { UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

const schema = z.object({ id: z.string().uuid(), count: z.coerce.number().int() });

const makeSut = () => ({ pipe: new ZodValidationPipe(schema, 'payload rejected') });

describe('Feature: validating request payloads at the HTTP boundary', () => {
  describe('Scenario: the payload matches the schema', () => {
    it('returns the parsed value, narrowed and coerced', () => {
      // Given
      const { pipe } = makeSut();
      const body = { id: '11111111-1111-4111-8111-111111111111', count: '3' };

      // When
      const result = pipe.transform(body);

      // Then
      // Coerced, so the service receives a number and never re-parses.
      expect(result).toEqual({ id: '11111111-1111-4111-8111-111111111111', count: 3 });
    });
  });

  describe('Scenario: the payload violates the schema', () => {
    it('rejects with 422 rather than 400', () => {
      // Given
      const { pipe } = makeSut();

      // When
      const reject = () => pipe.transform({ id: 'not-a-uuid', count: 'x' });

      // Then
      // The request was well-formed HTTP and its signature verified; what failed
      // is the meaning of the payload.
      expect(reject).toThrow(UnprocessableEntityException);
    });

    it('reports every failing field, not just the first', () => {
      // Given
      const { pipe } = makeSut();

      // When
      let thrown: UnprocessableEntityException | undefined;
      try {
        pipe.transform({ id: 'not-a-uuid', count: 'x' });
      } catch (error) {
        thrown = error as UnprocessableEntityException;
      }

      // Then
      // An ARRAY `message` is what AllExceptionsFilter promotes to the
      // structured `errors` key, with `error` as the human summary.
      const body = thrown?.getResponse() as { error: string; message: string[] };
      expect(body.error).toBe('payload rejected');
      expect(body.message).toHaveLength(2);
      expect(body.message.join(' ')).toContain('id');
      expect(body.message.join(' ')).toContain('count');
    });
  });
});
