import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * No Nest boot: a fake `HttpAdapterHost` and `ArgumentsHost` are enough to
 * exercise every branch of the filter directly.
 */

type HttpAdapterDouble = {
  reply: jest.Mock;
  getRequestMethod: jest.Mock;
  getRequestUrl: jest.Mock;
};

const makeSut = () => {
  const request = {};
  const response = {};
  const httpAdapter: HttpAdapterDouble = {
    reply: jest.fn(),
    getRequestMethod: jest.fn(() => 'GET'),
    getRequestUrl: jest.fn(() => '/some/path'),
  };
  const adapterHost = { httpAdapter } as unknown as HttpAdapterHost;
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

  return {
    host,
    httpAdapter,
    logger,
    filter: new AllExceptionsFilter(adapterHost),
  };
};

describe('Feature: every uncaught exception becomes one error envelope', () => {
  afterEach(() => {
    // Restores, not merely clears: the Logger spy is installed on a shared
    // prototype and would leak into the next test file otherwise.
    jest.restoreAllMocks();
  });

  describe('Scenario: an HttpException carries a plain string body', () => {
    it('envelopes the string as the message', () => {
      // Given
      const { host, httpAdapter, filter } = makeSut();

      // When
      filter.catch(new HttpException('plain message', HttpStatus.BAD_REQUEST), host);

      // Then
      expect(httpAdapter.reply).toHaveBeenCalledWith(
        {},
        { success: false, statusCode: 400, message: 'plain message' },
        400,
      );
    });
  });

  describe('Scenario: a built-in HttpException carries an object body', () => {
    it('envelopes the body without an errors key', () => {
      // Given
      const { host, httpAdapter, filter } = makeSut();

      // When
      filter.catch(new NotFoundException(), host);

      // Then
      expect(httpAdapter.reply).toHaveBeenCalledWith(
        {},
        { success: false, statusCode: 404, message: 'Not Found' },
        404,
      );
    });
  });

  describe('Scenario: a validation failure carries an array of messages', () => {
    it('surfaces the array as the structured errors field', () => {
      // Given
      const { host, httpAdapter, filter } = makeSut();

      // When
      filter.catch(new BadRequestException(['field a is required', 'field b is invalid']), host);

      // Then
      expect(httpAdapter.reply).toHaveBeenCalledWith(
        {},
        {
          success: false,
          statusCode: 400,
          message: 'Bad Request',
          errors: ['field a is required', 'field b is invalid'],
        },
        400,
      );
    });
  });

  describe('Scenario: a non-HttpException throwable reaches the filter', () => {
    it('never leaks the internal error text', () => {
      // Given
      const { host, httpAdapter, filter } = makeSut();

      // When
      filter.catch(new Error('leaked db connection string: postgres://...'), host);

      // Then
      expect(httpAdapter.reply).toHaveBeenCalledWith(
        {},
        { success: false, statusCode: 500, message: 'Internal server error' },
        500,
      );
    });
  });

  describe('Scenario: a thrown value is not an Error at all', () => {
    it('never leaks the thrown value', () => {
      // Given
      const { host, httpAdapter, filter } = makeSut();

      // When
      filter.catch('a bare string throw', host);

      // Then
      expect(httpAdapter.reply).toHaveBeenCalledWith(
        {},
        { success: false, statusCode: 500, message: 'Internal server error' },
        500,
      );
    });
  });

  describe('Scenario: the envelope carries a 5xx status', () => {
    it('logs the failure at error level', () => {
      // Given
      const { host, logger, filter } = makeSut();

      // When
      filter.catch(new Error('boom'), host);

      // Then
      expect(logger).toHaveBeenCalledTimes(1);
    });
  });

  describe('Scenario: the envelope carries a 4xx status', () => {
    it('does not log expected client traffic at error level', () => {
      // Given
      const { host, logger, filter } = makeSut();

      // When
      filter.catch(new NotFoundException(), host);

      // Then
      expect(logger).not.toHaveBeenCalled();
    });
  });
});
