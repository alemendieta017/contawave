import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
  Check,
} from 'typeorm';
import { SettlementType } from '@sistema-contable/shared';
import { CommitmentInstallmentEntity } from './commitment-installment.entity';
import { TransactionEntity } from './transaction.entity';
import { JournalEntryEntity } from './journal-entry.entity';

@Entity('commitment_settlements')
@Index(['installmentId'])
@Index(['transactionId'])
@Check(`"amount" > 0`)
export class CommitmentSettlementEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'installment_id', type: 'uuid' })
  installmentId: string;

  @ManyToOne(() => CommitmentInstallmentEntity, (installment) => installment.settlements, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'installment_id' })
  installment: CommitmentInstallmentEntity;

  @Column({ name: 'transaction_id', type: 'uuid' })
  transactionId: string;

  @ManyToOne(() => TransactionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'transaction_id' })
  transaction: TransactionEntity;

  @Column({ name: 'journal_entry_id', type: 'uuid' })
  journalEntryId: string;

  @ManyToOne(() => JournalEntryEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'journal_entry_id' })
  journalEntry: JournalEntryEntity;

  @Column({ name: 'settlement_type', type: 'varchar', length: 15 })
  settlementType: SettlementType;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  @Column({ name: 'settled_at', type: 'date' })
  settledAt: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
