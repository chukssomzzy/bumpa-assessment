import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { EVALUATE_QUEUE, type EvaluateJob } from '../../common/queues';

/**
 * Applies one purchase event, then emits the resulting domain events.
 *
 * Ordering is load-bearing: the transaction commits first, and only then are
 * AchievementUnlocked / BadgeUnlocked emitted. Their listeners enqueue work and
 * never perform it.
 */
@Processor(EVALUATE_QUEUE)
export class EvaluateProcessor extends WorkerHost {
  process(_job: Job<EvaluateJob>): Promise<void> {
    throw new Error('not implemented');
  }
}
