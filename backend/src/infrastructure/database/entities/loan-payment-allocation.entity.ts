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
import { LoanInstallmentEntity } from './loan-installment.entity';
import { TransactionEntity } from './transaction.entity';
import { JournalEntryEntity } from './journal-entry.entity';

@Entity('loan_payment_allocations')
@Index(['installmentId'])
@Index(['transactionId'])
@Check(`"allocated_principal" >= 0`)
export class LoanPaymentAllocationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'installment_id', type: 'uuid' })
  installmentId: string;

  @ManyToOne(() => LoanInstallmentEntity, (installment) => installment.allocations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'installment_id' })
  installment: LoanInstallmentEntity;

  @Column({ name: 'transaction_id', type: 'uuid' })
  transactionId: string;

  @ManyToOne(() => TransactionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'transaction_id' })
  transaction: TransactionEntity;

  @Column({ name: 'principal_journal_entry_id', type: 'uuid', nullable: true })
  principalJournalEntryId: string | null;

  @ManyToOne(() => JournalEntryEntity, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'principal_journal_entry_id' })
  principalJournalEntry: JournalEntryEntity | null;

  @Column({ name: 'allocated_principal', type: 'decimal', precision: 18, scale: 4, default: 0 })
  allocatedPrincipal: number;

  @Column({ name: 'allocated_charges_json', type: 'jsonb', default: () => "'{}'" })
  allocatedChargesJson: Record<string, number>;

  @Column({ name: 'paid_at', type: 'date' })
  paidAt: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
