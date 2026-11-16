import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  CreateDateColumn,
  Index,
  Check,
} from 'typeorm';
import { CommitmentFlowDirection, CommitmentOriginType } from '@sistema-contable/shared';
import { UserEntity } from './user.entity';
import { ContactEntity } from './contact.entity';
import { AccountEntity } from './account.entity';
import { TransactionEntity } from './transaction.entity';
import { CommitmentInstallmentEntity } from './commitment-installment.entity';

@Entity('commitments')
@Index(['userId'])
@Check(`"total_amount" > 0`)
export class CommitmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId: string;

  @ManyToOne(() => ContactEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'contact_id' })
  contact: ContactEntity;

  @Column({ type: 'varchar', length: 10 })
  direction: CommitmentFlowDirection;

  @Column({ name: 'origin_type', type: 'varchar', length: 25 })
  originType: CommitmentOriginType;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'total_amount', type: 'decimal', precision: 18, scale: 4 })
  totalAmount: number;

  @Column({ name: 'category_account_id', type: 'uuid', nullable: true })
  categoryAccountId: string | null;

  @ManyToOne(() => AccountEntity, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'category_account_id' })
  categoryAccount: AccountEntity | null;

  @Column({ name: 'cash_account_id', type: 'uuid', nullable: true })
  cashAccountId: string | null;

  @ManyToOne(() => AccountEntity, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'cash_account_id' })
  cashAccount: AccountEntity | null;

  @Column({ name: 'control_account_id', type: 'uuid' })
  controlAccountId: string;

  @ManyToOne(() => AccountEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'control_account_id' })
  controlAccount: AccountEntity;

  @Column({ name: 'initial_transaction_id', type: 'uuid' })
  initialTransactionId: string;

  @ManyToOne(() => TransactionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'initial_transaction_id' })
  initialTransaction: TransactionEntity;

  @OneToMany(() => CommitmentInstallmentEntity, (installment) => installment.commitment)
  installments: CommitmentInstallmentEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
