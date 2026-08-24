import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { PaystackSignatureGuard } from './paystack-signature.guard';
import { PayoutWebhookService } from './payout-webhook.service';

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
  @Post()
  @HttpCode(200)
  async handle(@Body() body: unknown): Promise<{ received: true }> {
    await this.webhooks.handle(body);
    return { received: true };
  }
}
