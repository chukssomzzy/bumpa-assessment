import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { EVALUATE_QUEUE } from '../common/queues';

@Injectable()
export class EventsService {
  constructor(@InjectQueue(EVALUATE_QUEUE) private readonly queue: Queue) {}

  /**
   * Validates the payload, confirms the user exists, and enqueues an evaluation
   * job keyed by event id so duplicate deliveries collapse.
   *
   * Throws 422 for a malformed payload or an unknown user.
   */
  accept(_body: unknown): Promise<{ accepted: true }> {
    throw new Error('not implemented');
  }
}
