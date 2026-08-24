import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { AchievementDefinitionEntity } from '../entities/achievement-definition.entity';

@Injectable()
export class AchievementDefinitionRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  /** The full achievement rule set. Small, static reference data — always read whole. */
  listAll(): Promise<AchievementDefinitionEntity[]> {
    return this.txHost.tx.find(AchievementDefinitionEntity);
  }
}
