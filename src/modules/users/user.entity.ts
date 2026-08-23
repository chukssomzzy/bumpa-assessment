import { Column, Entity, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserProgressEntity } from './user-progress.entity';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ unique: true })
  email!: string;

  /** Bank details are required to construct a transfer recipient. */
  @Column({ name: 'bank_code', nullable: true, type: 'varchar' })
  bankCode!: string | null;

  @Column({ name: 'account_number', nullable: true, type: 'varchar' })
  accountNumber!: string | null;

  /** Cached after the first payout so later transfers skip recipient creation. */
  @Column({ name: 'recipient_code', nullable: true, type: 'varchar' })
  recipientCode!: string | null;

  @OneToOne(() => UserProgressEntity, (p) => p.user)
  progress?: UserProgressEntity;
}
