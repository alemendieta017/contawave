import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountEntity } from '../database/entities/account.entity';
import { AccountPeriodBalanceEntity } from '../database/entities/account-period-balance.entity';
import { BudgetItemEntity } from '../database/entities/budget-item.entity';
import { CurrencyEntity } from '../database/entities/currency.entity';
import { JournalEntryEntity } from '../database/entities/journal-entry.entity';
import { LoanEntity } from '../database/entities/loan.entity';
import { LoanChargeColumnEntity } from '../database/entities/loan-charge-column.entity';
import { LoanInstallmentEntity } from '../database/entities/loan-installment.entity';
import { LoanPaymentAllocationEntity } from '../database/entities/loan-payment-allocation.entity';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { AuthModule } from '../auth/auth.module';
import { LedgerModule } from '../ledger/ledger.module';
import { CommitmentsModule } from '../commitments/commitments.module';
import { LoanController } from '../controllers/loan.controller';
import { GetLoansUseCase } from '../../application/loans/get-loans.use-case';
import { CreateLoanUseCase } from '../../application/loans/create-loan.use-case';
import { PayLoanInstallmentUseCase } from '../../application/loans/pay-loan-installment.use-case';
import { ReverseLoanPaymentUseCase } from '../../application/loans/reverse-loan-payment.use-case';
import { UpdateLoanPlanUseCase } from '../../application/loans/update-loan-plan.use-case';
import { DeleteLoanUseCase } from '../../application/loans/delete-loan.use-case';
import { LoanCashFlowAdapter } from '../../application/loans/loan-cash-flow.adapter';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LoanEntity,
      LoanChargeColumnEntity,
      LoanInstallmentEntity,
      LoanPaymentAllocationEntity,
      AccountEntity,
      CurrencyEntity,
      TransactionEntity,
      JournalEntryEntity,
      AccountPeriodBalanceEntity,
      BudgetItemEntity,
    ]),
    AuthModule,
    LedgerModule,
    CommitmentsModule,
  ],
  controllers: [LoanController],
  providers: [
    GetLoansUseCase,
    CreateLoanUseCase,
    PayLoanInstallmentUseCase,
    ReverseLoanPaymentUseCase,
    UpdateLoanPlanUseCase,
    DeleteLoanUseCase,
    LoanCashFlowAdapter,
  ],
  exports: [
    GetLoansUseCase,
    CreateLoanUseCase,
    PayLoanInstallmentUseCase,
    ReverseLoanPaymentUseCase,
    UpdateLoanPlanUseCase,
    DeleteLoanUseCase,
    LoanCashFlowAdapter,
  ],
})
export class LoansModule {}
