import { Processor, WorkerHost } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { EVALUATE_QUEUE, type EvaluateJob } from '../../common/queues';
import { AchievementsService } from '../achievements/achievements.service';
import { UserEntity } from '../users/user.entity';
import {
  ACHIEVEMENT_UNLOCKED,
  AchievementUnlockedEvent,
  BADGE_UNLOCKED,
  BadgeUnlockedEvent,
} from './domain-events';

/**
 * Applies one purchase event, then emits the resulting domain events.
 *
 * Ordering is load-bearing: the transaction commits first, and only then are
 * AchievementUnlocked / BadgeUnlocked emitted. Their listeners enqueue work and
 * never perform it.
 */
@Processor(EVALUATE_QUEUE)
export class EvaluateProcessor extends WorkerHost {
  constructor(
    private readonly achievements: AchievementsService,
    private readonly events: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  async process(job: Job<EvaluateJob>): Promise<void> {
    const { eventId, userId } = job.data;
    const result = await this.achievements.applyPurchaseEvent(eventId, userId);
    if (!result.applied) {
      return;
    }

    const user = await this.dataSource
      .getRepository(UserEntity)
      .findOneOrFail({ where: { id: userId } });

    for (const name of result.unlockedAchievementNames) {
      this.events.emit(ACHIEVEMENT_UNLOCKED, new AchievementUnlockedEvent(name, user));
    }
    for (const badge of result.unlockedBadges) {
      this.events.emit(BADGE_UNLOCKED, new BadgeUnlockedEvent(badge.name, user, badge.payoutId));
    }
  }
}
