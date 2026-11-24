import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoanDto } from '@sistema-contable/shared';
import { LoanEntity } from '../../infrastructure/database/entities/loan.entity';
import { LoanInstallmentEntity } from '../../infrastructure/database/entities/loan-installment.entity';
import { LoanPaymentAllocationEntity } from '../../infrastructure/database/entities/loan-payment-allocation.entity';
import { calculateLoanInstallmentDerived, roundMoney } from '../../domain/loans/loan-calculator';
import { ReverseTransactionUseCase } from '../ledger/reverse-transaction.use-case';
import { GetLoansUseCase } from './get-loans.use-case';

@Injectable()
export class ReverseLoanPaymentUseCase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reverseTransactionUseCase: ReverseTransactionUseCase,
    private readonly getLoansUseCase: GetLoansUseCase,
  ) {}

  async execute(userId: string, allocationId: string): Promise<LoanDto> {
    const loanId = await this.dataSource.transaction('SERIALIZABLE', async (em) => {
      const allocation = await em.findOne(LoanPaymentAllocationEntity, {
        where: { id: allocationId },
        relations: ['installment', 'installment.loan', 'transaction'],
      });

      if (!allocation || allocation.installment?.loan?.userId !== userId) {
        throw new NotFoundException(`Pago con ID ${allocationId} no encontrado`);
      }

      const loan = allocation.installment.loan;
      if (allocation.transaction?.status === 'REVERSED') {
        throw new BadRequestException('Este pago ya fue revertido anteriormente');
      }

      await this.reverseTransactionUseCase.executeWithManager(
        em,
        userId,
        allocation.transactionId,
        { allowControlled: true },
      );

      // Re-evaluar si el préstamo debe volver de SETTLED a ACTIVE
      const updatedLoan = await em.findOne(LoanEntity, {
        where: { id: loan.id, userId },
        relations: ['chargeColumns'],
      });
      const allInstallments =
        (await em.find(LoanInstallmentEntity, {
          where: { loanId: loan.id },
          relations: ['allocations', 'allocations.transaction'],
        })) || [];

      let totalPendingPrincipal = 0;
      const chargeColumns = updatedLoan?.chargeColumns || [];
      for (const inst of allInstallments) {
        const allocs = (inst.allocations || []).map((a) =>
          a.id === allocation.id
            ? { ...a, transaction: { ...(a.transaction || {}), status: 'REVERSED' } }
            : a,
        );
        const derived = calculateLoanInstallmentDerived(
          { ...inst, allocations: allocs },
          chargeColumns,
        );
        totalPendingPrincipal += derived.pendingPrincipal;
      }

      if (
        updatedLoan &&
        updatedLoan.status === 'SETTLED' &&
        roundMoney(totalPendingPrincipal) > 0.0001
      ) {
        updatedLoan.status = 'ACTIVE';
        await em.save(LoanEntity, updatedLoan);
      }

      return loan.id;
    });

    return this.getLoansUseCase.getById(userId, loanId);
  }
}
