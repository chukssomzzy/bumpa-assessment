import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { BadgeDefinitionEntity } from '../entities/badge-definition.entity';

@Injectable()
export class BadgeDefinitionRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  /** The full badge ladder. Small, static reference data — always read whole. */
  listAll(): Promise<BadgeDefinitionEntity[]> {
    return this.txHost.tx.find(BadgeDefinitionEntity);
  }
}
