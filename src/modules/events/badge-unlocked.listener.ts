import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import { PAYOUT_QUEUE, type PayoutJob } from '../../common/queues';
import { BADGE_UNLOCKED, type BadgeUnlockedEvent } from './domain-events';

/**
 * Reacts to a badge unlock by enqueueing its payout, keyed by payout id so a
 * redelivered event can never enqueue the same dispatch twice. Only enqueues:
 * the provider call happens in the payout worker, never here.
 */
@Injectable()
export class BadgeUnlockedListener {
  constructor(@InjectQueue(PAYOUT_QUEUE) private readonly queue: Queue<PayoutJob>) {}

  @OnEvent(BADGE_UNLOCKED)
  async handleBadgeUnlocked(event: BadgeUnlockedEvent): Promise<void> {
    await this.queue.add('payout', { payoutId: event.payoutId }, { jobId: event.payoutId });
  }
}
