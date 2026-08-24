import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { UseCls } from 'nestjs-cls';
import { PAYOUT_QUEUE, type PayoutJob } from '../../common/queues';
import { PayoutsService } from './payouts.service';

/**
 * `maxStalledCount: 0` is a money-path decision, not a tuning knob.
 *
 * `dispatch` is a read-modify-write on the payout row with no lock, so two
 * concurrent runs for one payout could both transfer. The job id is the payout
 * id, so BullMQ already gives one consumer at a time — except when it reclaims a
 * job it believes stalled while the original is still inside the provider call.
 * Refusing to re-run a stalled payout closes that window: the row stays
 * non-terminal and the sweeper recovers it, re-reading persisted state and
 * reconciling by reference rather than blindly re-transferring.
 */
@Processor(PAYOUT_QUEUE, { maxStalledCount: 0 })
export class PayoutProcessor extends WorkerHost {
  constructor(private readonly payouts: PayoutsService) {
    super();
  }

  // No ambient CLS context outside an HTTP request; `dispatch`'s repository
  // calls resolve their EntityManager off one, so a job needs its own — same
  // reasoning as `EvaluateProcessor`, even though `dispatch` itself never opens
  // a `@Transactional()` transaction (it must not: that would hold a DB
  // transaction open across the Paystack network call).
  @UseCls()
  async process(job: Job<PayoutJob>): Promise<void> {
    await this.payouts.dispatch(job.data.payoutId);
  }
}
