import { DataSource, type DataSourceOptions } from 'typeorm';
import { AchievementDefinitionEntity } from '../modules/achievements/entities/achievement-definition.entity';
import { BadgeDefinitionEntity } from '../modules/achievements/entities/badge-definition.entity';
import { UserAchievementEntity } from '../modules/achievements/entities/user-achievement.entity';
import { UserBadgeEntity } from '../modules/achievements/entities/user-badge.entity';
import { ProcessedEventEntity } from '../modules/events/processed-event.entity';
import { PayoutEntity } from '../modules/payouts/payout.entity';
import { UserProgressEntity } from '../modules/users/user-progress.entity';
import { UserEntity } from '../modules/users/user.entity';
import { InitialSchema1787486411006 } from './migrations/1787486411006-InitialSchema';

export const entities = [
  UserEntity,
  UserProgressEntity,
  AchievementDefinitionEntity,
  BadgeDefinitionEntity,
  UserAchievementEntity,
  UserBadgeEntity,
  PayoutEntity,
  ProcessedEventEntity,
];

export const migrations = [InitialSchema1787486411006];

export const dataSourceOptions = (url = process.env.DATABASE_URL): DataSourceOptions => ({
  type: 'postgres',
  url,
  entities,
  migrations,
  // Never synchronize: the deployed path and the tested path must be the same path.
  synchronize: false,
  logging: false,
});

export default new DataSource(dataSourceOptions());
