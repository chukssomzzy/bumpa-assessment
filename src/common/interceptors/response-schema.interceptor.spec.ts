import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { firstValueFrom, of } from 'rxjs';
import { z } from 'zod';
import { ResponseSchemaInterceptor } from './response-schema.interceptor';

const schema = z.object({ id: z.string(), count: z.number() });

type LoggerDouble = { error: jest.Mock };

const makeSut = (declared: unknown) => {
  const logger: LoggerDouble = { error: jest.fn() };
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(declared) };

  return {
    logger,
    interceptor: new ResponseSchemaInterceptor(
      reflector as unknown as Reflector,
      logger as unknown as PinoLogger,
    ),
  };
};

const context = {
  getHandler: () => function handler() {},
  getClass: () => class Controller {},
} as unknown as ExecutionContext;

const handlerReturning = (payload: unknown): CallHandler => ({ handle: () => of(payload) });

describe('Feature: enforcing the declared response shape', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Scenario: the handler declares no schema', () => {
    it('passes the payload through untouched', async () => {
      // Given
      const { interceptor } = makeSut(undefined);
      const payload = { anything: 'at all' };

      // When
      const result = await firstValueFrom(
        interceptor.intercept(context, handlerReturning(payload)),
      );

      // Then
      expect(result).toBe(payload);
    });
  });

  describe('Scenario: the response carries a field the contract never promised', () => {
    it('strips the extra field rather than failing the request', async () => {
      // Given
      const { interceptor } = makeSut(schema);

      // When
      const result = await firstValueFrom(
        interceptor.intercept(
          context,
          handlerReturning({ id: 'a', count: 1, internalEmail: 'ada@example.com' }),
        ),
      );

      // Then
      // The request computed the right answer; a leaked field is a bug, not a
      // reason to 500.
      expect(result).toEqual({ id: 'a', count: 1 });
    });
  });

  describe('Scenario: a stripped field must not disappear silently', () => {
    it('logs the leaked field names even though the payload parsed cleanly', async () => {
      // Given
      const { interceptor, logger } = makeSut(schema);

      // When
      await firstValueFrom(
        interceptor.intercept(
          context,
          handlerReturning({ id: 'a', count: 1, internalEmail: 'ada@example.com' }),
        ),
      );

      // Then
      // zod SUCCEEDS on extra keys and strips them, so validation alone reports
      // nothing here — which is the leak case, and the one most worth knowing
      // about. Key sets have to be compared explicitly.
      expect(logger.error).toHaveBeenCalledTimes(1);
      const [detail] = logger.error.mock.calls[0] as [{ leaked: string[] }];
      expect(detail.leaked).toEqual(['internalEmail']);
    });
  });

  describe('Scenario: the response does not satisfy the contract at all', () => {
    it('sends only the declared keys and logs the mismatch loudly', async () => {
      // Given
      const { interceptor, logger } = makeSut(schema);

      // When
      const result = await firstValueFrom(
        interceptor.intercept(context, handlerReturning({ id: 'a', count: 'not-a-number', x: 1 })),
      );

      // Then
      // Never throws — but stripping silently is what makes this pattern
      // dangerous, so the mismatch has to be visible.
      expect(result).toEqual({ id: 'a', count: 'not-a-number' });
      expect(logger.error).toHaveBeenCalledTimes(1);
      const [detail] = logger.error.mock.calls[0] as [{ issues: string[] }];
      expect(detail.issues.join(' ')).toContain('count');
    });
  });
});
