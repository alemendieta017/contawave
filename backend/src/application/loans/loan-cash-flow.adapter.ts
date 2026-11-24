import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CashFlowCommitmentSource, ScheduledCashFlowItem } from '@sistema-contable/shared';
import { LoanInstallmentEntity } from '../../infrastructure/database/entities/loan-installment.entity';
import { calculateLoanInstallmentDerived, roundMoney } from '../../domain/loans/loan-calculator';

@Injectable()
export class LoanCashFlowAdapter implements CashFlowCommitmentSource {
  constructor(
    @InjectRepository(LoanInstallmentEntity)
    private readonly installmentRepository: Repository<LoanInstallmentEntity>,
  ) {}

  async getScheduledCashFlowItems(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<ScheduledCashFlowItem[]> {
    const installments = await this.installmentRepository
      .createQueryBuilder('inst')
      .innerJoinAndSelect('inst.loan', 'loan')
      .leftJoinAndSelect('loan.currency', 'currency')
      .leftJoinAndSelect('loan.initialTransaction', 'initialTx')
      .leftJoinAndSelect('loan.chargeColumns', 'chargeColumns')
      .leftJoinAndSelect('inst.allocations', 'allocations')
      .leftJoinAndSelect('allocations.transaction', 'allocTx')
      .where('loan.userId = :userId', { userId })
      .andWhere('loan.status = :status', { status: 'ACTIVE' })
      .andWhere('inst.dueDate >= :startDate', { startDate })
      .andWhere('inst.dueDate <= :endDate', { endDate })
      .orderBy('inst.dueDate', 'ASC')
      .addOrderBy('inst.installmentNumber', 'ASC')
      .getMany();

    const items: ScheduledCashFlowItem[] = [];

    for (const inst of installments) {
      const loan = inst.loan;
      if (!loan || loan.initialTransaction?.status === 'REVERSED') {
        continue;
      }

      const chargeColumns = loan.chargeColumns || [];
      const derived = calculateLoanInstallmentDerived(inst, chargeColumns);
      if (derived.pendingPrincipal <= 0) {
        continue;
      }

      const rateToBase =
        Number(loan.currency?.rateToBase || 1) > 0 ? Number(loan.currency.rateToBase) : 1;
      const dueDateStr = String(inst.dueDate);
      const periodName = dueDateStr.substring(0, 7);

      // 1. Capital pendiente -> Cuenta de Pasivo dedicada del préstamo (Cuadrante 4)
      const principalBase = roundMoney(derived.pendingPrincipal * rateToBase);
      if (principalBase > 0) {
        items.push({
          dueDate: dueDateStr,
          periodName,
          amount: principalBase,
          direction: 'OUTFLOW',
          categoryAccountId: loan.liabilityAccountId,
          controlAccountId: loan.liabilityAccountId,
          sourceType: 'LOAN',
          sourceId: inst.id,
          loanId: loan.id,
          label: `${loan.name} · Capital (Cuota #${inst.installmentNumber})`,
        });
      }

      // 2. Rubros de cargo pendientes agrupados por cuenta de gasto (Cuadrante 2 / P&L)
      const groupedPendingByExpense = new Map<string, number>();
      for (const col of chargeColumns) {
        if (col.isActive === false) continue;
        const pendingCol = Math.max(0, Number(derived.pendingCharges[col.id] || 0));
        if (pendingCol <= 0) continue;
        groupedPendingByExpense.set(
          col.expenseAccountId,
          roundMoney((groupedPendingByExpense.get(col.expenseAccountId) || 0) + pendingCol),
        );
      }

      for (const [expenseAccountId, pendingAmt] of groupedPendingByExpense.entries()) {
        const amountBase = roundMoney(pendingAmt * rateToBase);
        if (amountBase <= 0) continue;
        items.push({
          dueDate: dueDateStr,
          periodName,
          amount: amountBase,
          direction: 'OUTFLOW',
          categoryAccountId: expenseAccountId,
          sourceType: 'LOAN',
          sourceId: inst.id,
          loanId: loan.id,
          label: `${loan.name} · Cargos (Cuota #${inst.installmentNumber})`,
        });
      }
    }

    return items;
  }
}
