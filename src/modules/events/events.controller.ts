import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { HmacGuard } from './hmac.guard';
import { EventsService } from './events.service';

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
  @Post()
  @HttpCode(202)
  ingest(
    @Body() body: unknown,
    @Req() request: Request & { id?: string },
  ): Promise<{ accepted: true }> {
    return this.events.accept(body, request.id);
  }
}
