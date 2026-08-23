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

function buildHost(): { host: ArgumentsHost; adapterHost: HttpAdapterHost; reply: jest.Mock } {
  const request = {};
  const response = {};
  const reply = jest.fn();
  const httpAdapter = {
    reply,
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
  return { host, adapterHost, reply };
}

describe('AllExceptionsFilter', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('envelopes an HttpException whose body is a plain string', () => {
    const { host, adapterHost, reply } = buildHost();
    const filter = new AllExceptionsFilter(adapterHost);

    filter.catch(new HttpException('plain message', HttpStatus.BAD_REQUEST), host);

    expect(reply).toHaveBeenCalledWith(
      {},
      { success: false, statusCode: 400, message: 'plain message' },
      400,
    );
  });

  it('envelopes a built-in HttpException with an object body, without an errors key', () => {
    const { host, adapterHost, reply } = buildHost();
    const filter = new AllExceptionsFilter(adapterHost);

    filter.catch(new NotFoundException(), host);

    expect(reply).toHaveBeenCalledWith(
      {},
      { success: false, statusCode: 404, message: 'Not Found' },
      404,
    );
  });

  it('surfaces a validation-style array message as the structured errors field', () => {
    const { host, adapterHost, reply } = buildHost();
    const filter = new AllExceptionsFilter(adapterHost);

    filter.catch(new BadRequestException(['field a is required', 'field b is invalid']), host);

    expect(reply).toHaveBeenCalledWith(
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

  it('never leaks internal error text for a non-HttpException throwable', () => {
    const { host, adapterHost, reply } = buildHost();
    const filter = new AllExceptionsFilter(adapterHost);

    filter.catch(new Error('leaked db connection string: postgres://...'), host);

    expect(reply).toHaveBeenCalledWith(
      {},
      { success: false, statusCode: 500, message: 'Internal server error' },
      500,
    );
  });

  it('never leaks internal error text for a thrown non-Error value', () => {
    const { host, adapterHost, reply } = buildHost();
    const filter = new AllExceptionsFilter(adapterHost);

    filter.catch('a bare string throw', host);

    expect(reply).toHaveBeenCalledWith(
      {},
      { success: false, statusCode: 500, message: 'Internal server error' },
      500,
    );
  });

  it('logs at error level for a 5xx response', () => {
    const { host, adapterHost } = buildHost();
    const filter = new AllExceptionsFilter(adapterHost);

    filter.catch(new Error('boom'), host);

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('does not log at error level for a 4xx response', () => {
    const { host, adapterHost } = buildHost();
    const filter = new AllExceptionsFilter(adapterHost);

    filter.catch(new NotFoundException(), host);

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
