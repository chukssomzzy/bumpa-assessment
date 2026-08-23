import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PayoutsService } from './payouts.service';

/**
 * Closes the gap between committing a payout row and enqueueing its job. A crash
 * in between leaves a pending row with no job; this finds it and re-dispatches.
 */
@Injectable()
export class PayoutSweeperService {
  private readonly logger = new Logger(PayoutSweeperService.name);

  constructor(private readonly payouts: PayoutsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    const requeued = await this.payouts.sweepStalePayouts();
    if (requeued > 0) this.logger.warn(`re-enqueued ${requeued} stale payout(s)`);
  }
}
