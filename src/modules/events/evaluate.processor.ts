import { Processor, WorkerHost } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
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
    // Plain `PinoLogger`, not `@InjectPinoLogger(name)`: that decorator's
    // per-context provider is only registered for classes that were already
    // `require`d by the time `LoggerModule.forRootAsync` runs, which is an
    // import-order trap across module boundaries. `setContext` gets the same
    // labelled output without depending on it.
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(EvaluateProcessor.name);
  }

  async process(job: Job<EvaluateJob>): Promise<void> {
    const { eventId, userId, requestId } = job.data;
    // Ties this job's log lines back to the HTTP request that enqueued it,
    // when one exists (not every producer of this queue is HTTP-triggered).
    this.logger.info({ eventId, userId, requestId }, 'evaluating purchase event');
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
