import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { EVALUATE_QUEUE, type EvaluateJob } from '../../common/queues';
import { UserRepository } from '../users/repositories/user.repository';
import type { PurchaseEvent } from './dto/purchase-event.dto';

@Injectable()
export class EventsService {
  constructor(
    @InjectQueue(EVALUATE_QUEUE) private readonly queue: Queue<EvaluateJob>,
    private readonly users: UserRepository,
  ) {}

  /**
   * Confirms the user exists and enqueues an evaluation job keyed by event id
   * so duplicate deliveries collapse.
   *
   * Takes an already-validated `PurchaseEvent`: shape checking belongs to
   * `ZodValidationPipe` at the controller boundary, not here. What remains is
   * the one check that genuinely needs this layer, because it needs the
   * database — an unknown user.
   *
   * `requestId` carries the HTTP request's correlation id into the job so the
   * worker's logs can be traced back to it; optional so a caller without one
   * (a test, a future non-HTTP producer) still type-checks.
   *
   * Throws 422 for an unknown user.
   */
  async accept(event: PurchaseEvent, requestId?: string): Promise<{ accepted: true }> {
    if (!(await this.users.exists(event.userId))) {
      throw new UnprocessableEntityException('unknown user');
    }

    // No state written here: dedupe belongs to the evaluation transaction, so a
    // crash before this enqueue stays recoverable by the producer's retry.
    await this.queue.add(
      'evaluate',
      { eventId: event.eventId, userId: event.userId, occurredAt: event.occurredAt, requestId },
      { jobId: event.eventId },
    );

    return { accepted: true };
  }
}
