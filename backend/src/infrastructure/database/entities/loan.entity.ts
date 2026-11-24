import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
} from 'typeorm';
import { LoanStatus } from '@sistema-contable/shared';
import { UserEntity } from './user.entity';
import { CurrencyEntity } from './currency.entity';
import { AccountEntity } from './account.entity';
import { TransactionEntity } from './transaction.entity';
import { LoanChargeColumnEntity } from './loan-charge-column.entity';
import { LoanInstallmentEntity } from './loan-installment.entity';

@Entity('loans')
@Index(['userId'])
@Index(['userId', 'status'])
@Index(['liabilityAccountId'], { unique: true })
@Check(`"initial_principal" >= 0`)
@Check(`"annual_rate" >= 0`)
@Check(`"start_installment_number" >= 1`)
@Check(`"total_installments_count" >= 1`)
@Check(`"status" IN ('ACTIVE', 'SETTLED', 'CANCELLED')`)
export class LoanEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ name: 'currency_id', type: 'uuid' })
  currencyId: string;

  @ManyToOne(() => CurrencyEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'currency_id' })
  currency: CurrencyEntity;

  @Column({ name: 'initial_principal', type: 'decimal', precision: 18, scale: 4 })
  initialPrincipal: number;

  @Column({ name: 'annual_rate', type: 'decimal', precision: 8, scale: 4, default: 0 })
  annualRate: number;

  @Column({ name: 'opening_date', type: 'date' })
  openingDate: string;

  @Column({ name: 'start_installment_number', type: 'int', default: 1 })
  startInstallmentNumber: number;

  @Column({ name: 'total_installments_count', type: 'int' })
  totalInstallmentsCount: number;

  @Column({ name: 'liability_account_id', type: 'uuid' })
  liabilityAccountId: string;

  @ManyToOne(() => AccountEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'liability_account_id' })
  liabilityAccount: AccountEntity;

  @Column({ name: 'default_payment_account_id', type: 'uuid', nullable: true })
  defaultPaymentAccountId: string | null;

  @ManyToOne(() => AccountEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'default_payment_account_id' })
  defaultPaymentAccount: AccountEntity | null;

  @Column({ name: 'initial_transaction_id', type: 'uuid' })
  initialTransactionId: string;

  @ManyToOne(() => TransactionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'initial_transaction_id' })
  initialTransaction: TransactionEntity;

  @Column({ type: 'varchar', length: 15, default: 'ACTIVE' })
  status: LoanStatus;

  @OneToMany(() => LoanChargeColumnEntity, (col) => col.loan)
  chargeColumns: LoanChargeColumnEntity[];

  @OneToMany(() => LoanInstallmentEntity, (installment) => installment.loan)
  installments: LoanInstallmentEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
