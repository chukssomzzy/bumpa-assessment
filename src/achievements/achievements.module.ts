import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';
import { AchievementDefinitionEntity } from './entities/achievement-definition.entity';
import { BadgeDefinitionEntity } from './entities/badge-definition.entity';
import { UserAchievementEntity } from './entities/user-achievement.entity';
import { UserBadgeEntity } from './entities/user-badge.entity';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([
      AchievementDefinitionEntity,
      BadgeDefinitionEntity,
      UserAchievementEntity,
      UserBadgeEntity,
    ]),
  ],
  controllers: [AchievementsController],
  providers: [AchievementsService],
  exports: [AchievementsService],
})
export class AchievementsModule {}
