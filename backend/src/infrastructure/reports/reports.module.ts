import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalEntryEntity } from '../database/entities/journal-entry.entity';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { AccountEntity } from '../database/entities/account.entity';
import { PeriodEntity } from '../database/entities/period.entity';
import { AccountPeriodBalanceEntity } from '../database/entities/account-period-balance.entity';
import { BudgetEntity } from '../database/entities/budget.entity';
import { CommitmentEntity } from '../database/entities/commitment.entity';
import { CommitmentInstallmentEntity } from '../database/entities/commitment-installment.entity';
import { CommitmentSettlementEntity } from '../database/entities/commitment-settlement.entity';
import { GetCategoryStatisticsUseCase } from '../../application/reports/get-category-statistics.use-case';
import { ExportExcelService } from '../../application/reports/export-excel.service';
import { ReconstructBalancesUseCase } from '../../application/periods/reconstruct-balances.use-case';
import { BalanceSheetUseCase } from '../../application/periods/balance-sheet.use-case';
import { IncomeStatementUseCase } from '../../application/periods/income-statement.use-case';
import { IncomeStatementForecastUseCase } from '../../application/reports/income-statement-forecast.use-case';
import { CashFlowStatementForecastUseCase } from '../../application/reports/cash-flow-statement.use-case';
import { NetWorthEvolutionUseCase } from '../../application/reports/net-worth-evolution.use-case';
import { ReportsController } from '../controllers/reports.controller';
import { AuthModule } from '../auth/auth.module';
import { CommitmentsModule } from '../commitments/commitments.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      JournalEntryEntity,
      TransactionEntity,
      AccountEntity,
      PeriodEntity,
      AccountPeriodBalanceEntity,
      BudgetEntity,
      CommitmentEntity,
      CommitmentInstallmentEntity,
      CommitmentSettlementEntity,
    ]),
    AuthModule,
    CommitmentsModule,
  ],
  providers: [
    GetCategoryStatisticsUseCase,
    ExportExcelService,
    ReconstructBalancesUseCase,
    BalanceSheetUseCase,
    IncomeStatementUseCase,
    IncomeStatementForecastUseCase,
    CashFlowStatementForecastUseCase,
    NetWorthEvolutionUseCase,
  ],
  controllers: [ReportsController],
  exports: [
    GetCategoryStatisticsUseCase,
    ExportExcelService,
    ReconstructBalancesUseCase,
    BalanceSheetUseCase,
    IncomeStatementUseCase,
    IncomeStatementForecastUseCase,
    CashFlowStatementForecastUseCase,
    NetWorthEvolutionUseCase,
  ],
})
export class ReportsModule {}
