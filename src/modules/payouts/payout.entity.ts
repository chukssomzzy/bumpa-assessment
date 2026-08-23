import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PayoutStatus = 'pending' | 'processing' | 'succeeded' | 'failed';

/**
 * Doubles as the outbox: a row is written `pending` in the same transaction as
 * the badge it pays for, so a badge can never exist without a payout intent.
 * The unique constraint is what makes a second transfer impossible.
 */
@Entity('payouts')
@Index(['userId', 'badgeKey'], { unique: true })
export class PayoutEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'badge_key' })
  badgeKey!: string;

  /** Minor units. No floating point anywhere in the money path. */
  @Column({ name: 'amount_kobo', type: 'int' })
  amountKobo!: number;

  @Column({ type: 'varchar', default: 'pending' })
  status!: PayoutStatus;

  /** Idempotency key presented to the provider; also how an ambiguous timeout is reconciled. */
  @Column({ name: 'provider_reference', type: 'varchar', unique: true })
  providerReference!: string;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
