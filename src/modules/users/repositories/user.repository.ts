import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { UserEntity } from '../user.entity';

@Injectable()
export class UserRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  /** Existence check for payload validation, never the entity itself. */
  async exists(userId: string): Promise<boolean> {
    const count = await this.txHost.tx.count(UserEntity, { where: { id: userId } });
    return count > 0;
  }

  findByIdOrFail(userId: string): Promise<UserEntity> {
    return this.txHost.tx.findOneOrFail(UserEntity, { where: { id: userId } });
  }

  /** Caches the resolved transfer recipient so later payouts skip recipient creation. */
  async cacheRecipientCode(userId: string, recipientCode: string): Promise<void> {
    await this.txHost.tx.update(UserEntity, userId, { recipientCode });
  }
}
