import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse } from '../../common/dto/error-response.dto';
import { PaystackSignatureGuard } from './paystack-signature.guard';
import { PayoutWebhookService } from './payout-webhook.service';

@ApiTags('webhooks')
@Controller('webhooks/paystack')
@UseGuards(PaystackSignatureGuard)
export class PayoutWebhookController {
  constructor(private readonly webhooks: PayoutWebhookService) {}

  /**
   * Accepts a Paystack transfer notification.
   *
   * Always 200 once the signature verifies, whatever the payload turns out to
   * contain. Paystack redelivers on any non-2xx, so answering 4xx to an event
   * we have no use for buys an unbounded retry loop and changes nothing. An
   * unsigned request is the one case that is rejected, by the guard, before
   * this method runs.
   */
  @ApiOperation({
    summary: 'Receive a Paystack transfer notification',
    description:
      'Re-drives reconciliation for the payout named by `data.reference`. This endpoint is a latency ' +
      'optimisation, never a correctness dependency — the worker reconciles by reference on its next run ' +
      'and a sweeper re-drives anything left behind, so dropping every webhook still settles payouts.\n\n' +
      'Answers 200 for **any** signed request, including events it has no use for. A non-2xx makes Paystack ' +
      'redeliver, so rejecting an irrelevant event would buy an unbounded retry loop and change nothing. ' +
      'Redelivery is deduplicated by a receipt derived from the payload, because Paystack sends no event id.',
  })
  @ApiHeader({
    name: 'x-paystack-signature',
    required: true,
    description:
      'Hex HMAC-SHA512 over the raw body ALONE, keyed by the Paystack secret key. Note this differs from ' +
      '`POST /events`, which binds a timestamp into the signed payload — Paystack sends no timestamp header.',
  })
  @ApiOkResponse({
    description: 'Signature verified. The event was recorded, acted on, or deliberately ignored.',
    schema: { type: 'object', properties: { received: { type: 'boolean', example: true } } },
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing or incorrect signature — or no Paystack key configured, in which case this fails closed.',
    type: ErrorResponse,
  })
  @Post()
  @HttpCode(200)
  async handle(@Body() body: unknown): Promise<{ received: true }> {
    await this.webhooks.handle(body);
    return { received: true };
  }
}
