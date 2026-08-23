import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { EVALUATE_QUEUE, type EvaluateJob } from '../../common/queues';
import { UserEntity } from '../users/user.entity';
import { purchaseEventSchema } from './dto/purchase-event.dto';

@Injectable()
export class EventsService {
  constructor(
    @InjectQueue(EVALUATE_QUEUE) private readonly queue: Queue<EvaluateJob>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
  ) {}

  /**
   * Validates the payload, confirms the user exists, and enqueues an evaluation
   * job keyed by event id so duplicate deliveries collapse.
   *
   * Throws 422 for a malformed payload or an unknown user.
   */
  async accept(body: unknown): Promise<{ accepted: true }> {
    const result = purchaseEventSchema.safeParse(body);
    if (!result.success) {
      throw new UnprocessableEntityException('invalid purchase event payload');
    }
    const event = result.data;

    const user = await this.users.findOne({ where: { id: event.userId } });
    if (!user) {
      throw new UnprocessableEntityException('unknown user');
    }

    // No state written here: dedupe belongs to the evaluation transaction, so a
    // crash before this enqueue stays recoverable by the producer's retry.
    await this.queue.add(
      'evaluate',
      { eventId: event.eventId, userId: event.userId, occurredAt: event.occurredAt },
      { jobId: event.eventId },
    );

    return { accepted: true };
  }
}
