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
import { LoanEntity } from './loan.entity';
import { LoanPaymentAllocationEntity } from './loan-payment-allocation.entity';

@Entity('loan_installments')
@Index(['loanId'])
@Index(['dueDate'])
@Check(`"installment_number" >= 1`)
@Check(`"principal_amount" > 0`)
export class LoanInstallmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'loan_id', type: 'uuid' })
  loanId: string;

  @ManyToOne(() => LoanEntity, (loan) => loan.installments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'loan_id' })
  loan: LoanEntity;

  @Column({ name: 'installment_number', type: 'int' })
  installmentNumber: number;

  @Column({ name: 'due_date', type: 'date' })
  dueDate: string;

  @Column({ name: 'principal_amount', type: 'decimal', precision: 18, scale: 4 })
  principalAmount: number;

  @Column({ name: 'charges_json', type: 'jsonb', default: () => "'{}'" })
  chargesJson: Record<string, number>;

  @OneToMany(() => LoanPaymentAllocationEntity, (allocation) => allocation.installment)
  allocations: LoanPaymentAllocationEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
