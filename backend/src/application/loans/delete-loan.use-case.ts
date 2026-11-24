import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DeleteLoanResponse } from '@sistema-contable/shared';
import { AccountEntity } from '../../infrastructure/database/entities/account.entity';
import { AccountPeriodBalanceEntity } from '../../infrastructure/database/entities/account-period-balance.entity';
import { BudgetItemEntity } from '../../infrastructure/database/entities/budget-item.entity';
import { LoanEntity } from '../../infrastructure/database/entities/loan.entity';
import { LoanChargeColumnEntity } from '../../infrastructure/database/entities/loan-charge-column.entity';
import { LoanInstallmentEntity } from '../../infrastructure/database/entities/loan-installment.entity';
import { TransactionEntity } from '../../infrastructure/database/entities/transaction.entity';
import { SystemAccountService } from '../commitments/system-account.service';
import { ReverseTransactionUseCase } from '../ledger/reverse-transaction.use-case';

@Injectable()
export class DeleteLoanUseCase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly systemAccountService: SystemAccountService,
    private readonly reverseTransactionUseCase: ReverseTransactionUseCase,
  ) {}

  async execute(userId: string, loanId: string): Promise<DeleteLoanResponse> {
    return this.dataSource.transaction('SERIALIZABLE', async (em) => {
      const loan = await em.findOne(LoanEntity, {
        where: { id: loanId, userId },
        relations: [
          'liabilityAccount',
          'initialTransaction',
          'installments',
          'installments.allocations',
          'installments.allocations.transaction',
        ],
      });

      if (!loan) {
        throw new NotFoundException(`Préstamo con ID ${loanId} no encontrado`);
      }

      const allAllocations = (loan.installments || []).flatMap((i) => i.allocations || []);
      const activeAllocations = allAllocations.filter(
        (a) => !a.transaction || a.transaction.status === 'POSTED',
      );

      const loanTransactions =
        (await em.find(TransactionEntity, {
          where: { userId, originModule: 'LOAN', originEntityId: loan.id },
        })) || [];

      const allocationTxIds = new Set(allAllocations.map((a) => a.transactionId));
      const nonInitialTxs = loanTransactions.filter(
        (tx) => tx.id !== loan.initialTransactionId && !allocationTxIds.has(tx.id),
      );
      const activeAdjustments = nonInitialTxs.filter(
        (tx) => tx.status === 'POSTED' && !tx.reversalOfId,
      );

      if (activeAllocations.length > 0 || activeAdjustments.length > 0) {
        throw new BadRequestException(
          'No se puede eliminar el préstamo mientras existan pagos o ajustes activos registrados. Revertí esos movimientos primero.',
        );
      }

      const isVirgin =
        allAllocations.length === 0 &&
        nonInitialTxs.length === 0 &&
        loan.initialTransaction?.status !== 'REVERSED';

      if (isVirgin) {
        await em.delete(LoanInstallmentEntity, { loanId: loan.id });
        await em.delete(LoanChargeColumnEntity, { loanId: loan.id });
        await em.delete(LoanEntity, { id: loan.id, userId });

        await this.systemAccountService.deletePostedTransactionWithBalances(
          em,
          userId,
          loan.initialTransactionId,
        );

        await em.delete(AccountPeriodBalanceEntity, { accountId: loan.liabilityAccountId });
        await em.delete(BudgetItemEntity, { accountId: loan.liabilityAccountId });
        await em.delete(AccountEntity, { id: loan.liabilityAccountId, userId });

        return { success: true, action: 'DELETED' };
      }

      // Préstamo con historial revertido: anular de forma inmutable
      if (loan.initialTransaction && loan.initialTransaction.status === 'POSTED') {
        await this.reverseTransactionUseCase.executeWithManager(
          em,
          userId,
          loan.initialTransactionId,
          { allowControlled: true },
        );
      }

      loan.status = 'CANCELLED';
      await em.save(LoanEntity, loan);

      if (loan.liabilityAccount && loan.liabilityAccount.status !== 'INACTIVE') {
        loan.liabilityAccount.status = 'INACTIVE';
        await em.save(AccountEntity, loan.liabilityAccount);
      }

      return { success: true, action: 'CANCELLED' };
    });
  }
}
