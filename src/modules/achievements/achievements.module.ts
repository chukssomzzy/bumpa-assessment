import { Module } from '@nestjs/common';
import { PayoutsModule } from '../payouts/payouts.module';
import { UsersModule } from '../users/users.module';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';
import { AchievementDefinitionRepository } from './repositories/achievement-definition.repository';
import { BadgeDefinitionRepository } from './repositories/badge-definition.repository';
import { UserAchievementRepository } from './repositories/user-achievement.repository';
import { UserBadgeRepository } from './repositories/user-badge.repository';
import { UserProgressRepository } from './repositories/user-progress.repository';
import { ProcessedEventRepository } from '../events/repositories/processed-event.repository';

/**
 * `ProcessedEventRepository` is registered here as well as in `PayoutsModule`
 * (and would be in `EventsModule` if it needed one). That is a provider
 * registration, not a module import, so it creates no cycle back to
 * `EventsModule` — which itself imports this module. `PayoutsModule` can be
 * imported directly, though: it does not depend on `AchievementsModule`.
 */
@Module({
  imports: [UsersModule, PayoutsModule],
  controllers: [AchievementsController],
  providers: [
    AchievementsService,
    AchievementDefinitionRepository,
    BadgeDefinitionRepository,
    UserAchievementRepository,
    UserBadgeRepository,
    UserProgressRepository,
    ProcessedEventRepository,
  ],
  exports: [AchievementsService],
})
export class AchievementsModule {}
