import { DataSource, type DataSourceOptions } from 'typeorm';
import { AchievementDefinitionEntity } from '../achievements/entities/achievement-definition.entity';
import { BadgeDefinitionEntity } from '../achievements/entities/badge-definition.entity';
import { UserAchievementEntity } from '../achievements/entities/user-achievement.entity';
import { UserBadgeEntity } from '../achievements/entities/user-badge.entity';
import { ProcessedEventEntity } from '../events/processed-event.entity';
import { PayoutEntity } from '../payouts/payout.entity';
import { UserProgressEntity } from '../users/user-progress.entity';
import { UserEntity } from '../users/user.entity';
import { InitialSchema1700000000000 } from './migrations/1700000000000-InitialSchema';

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

export const migrations = [InitialSchema1700000000000];

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
