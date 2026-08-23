import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PAYOUT_QUEUE, type PayoutJob } from '../common/queues';
import { PayoutsService } from './payouts.service';

@Processor(PAYOUT_QUEUE)
export class PayoutProcessor extends WorkerHost {
  constructor(private readonly payouts: PayoutsService) {
    super();
  }

  async process(job: Job<PayoutJob>): Promise<void> {
    await this.payouts.dispatch(job.data.payoutId);
  }
}
