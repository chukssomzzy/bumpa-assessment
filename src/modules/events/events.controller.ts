import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/dto/error-response.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  PurchaseEventBody,
  type PurchaseEvent,
  purchaseEventSchema,
} from './dto/purchase-event.dto';
import { HmacGuard } from './hmac.guard';
import { EventsService } from './events.service';

@ApiTags('events')
@Controller('events')
@UseGuards(HmacGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /**
   * Accepts a purchase event and returns 202 once it is durably queued.
   *
   * Deliberately writes no state: dedupe belongs to the evaluation transaction,
   * so a crash before enqueue stays recoverable by the producer's retry.
   */
  @ApiOperation({
    summary: 'Ingest a signed purchase event',
    description:
      'Verifies the signature, queues the event and returns immediately — evaluation happens on a worker. ' +
      'Redelivering an event with the same `eventId` is a no-op, so producer retries are safe.',
  })
  @ApiHeader({
    name: 'x-signature',
    required: true,
    description:
      'Hex HMAC-SHA512 over `{x-timestamp}.{rawBody}`, keyed by the shared storefront secret.',
  })
  @ApiHeader({
    name: 'x-timestamp',
    required: true,
    description:
      'Unix seconds. Signed as part of the payload, so a captured request cannot be replayed by rewriting it. Rejected outside the freshness window.',
  })
  @ApiBody({ type: PurchaseEventBody })
  @ApiAcceptedResponse({
    description: 'Durably queued. No state is written synchronously.',
    schema: { type: 'object', properties: { accepted: { type: 'boolean', example: true } } },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, malformed, stale or incorrect signature.',
    type: ErrorResponse,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The signature verified but the payload is not a valid purchase event, or the customer is unknown.',
    type: ErrorResponse,
  })
  @Post()
  @HttpCode(202)
  ingest(
    @Body(new ZodValidationPipe(purchaseEventSchema, 'invalid purchase event payload'))
    event: PurchaseEvent,
    @Req() request: Request & { id?: string },
  ): Promise<{ accepted: true }> {
    return this.events.accept(event, request.id);
  }
}
