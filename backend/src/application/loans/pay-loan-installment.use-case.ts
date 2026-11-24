import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  LoanDto,
  PayLoanInstallmentRequest,
  PayLoanInstallmentRequestSchema,
} from '@sistema-contable/shared';
import { AccountEntity } from '../../infrastructure/database/entities/account.entity';
import { LoanEntity } from '../../infrastructure/database/entities/loan.entity';
import { LoanInstallmentEntity } from '../../infrastructure/database/entities/loan-installment.entity';
import { LoanPaymentAllocationEntity } from '../../infrastructure/database/entities/loan-payment-allocation.entity';
import { calculateLoanInstallmentDerived, roundMoney } from '../../domain/loans/loan-calculator';
import { MultiEntryItem, SystemAccountService } from '../commitments/system-account.service';
import { isControlAccount } from '../ledger/transaction-guards';
import { GetLoansUseCase } from './get-loans.use-case';

@Injectable()
export class PayLoanInstallmentUseCase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly systemAccountService: SystemAccountService,
    private readonly getLoansUseCase: GetLoansUseCase,
  ) {}

  async execute(
    userId: string,
    installmentId: string,
    dto: PayLoanInstallmentRequest,
  ): Promise<LoanDto> {
    const parsed = PayLoanInstallmentRequestSchema.parse(dto);

    const loanId = await this.dataSource.transaction('SERIALIZABLE', async (em) => {
      const installment = await em.findOne(LoanInstallmentEntity, {
        where: { id: installmentId },
        relations: [
          'loan',
          'loan.currency',
          'loan.chargeColumns',
          'allocations',
          'allocations.transaction',
        ],
      });

      if (!installment || installment.loan?.userId !== userId) {
        throw new NotFoundException(`Cuota con ID ${installmentId} no encontrada`);
      }

      const loan = installment.loan;
      if (loan.status === 'CANCELLED') {
        throw new BadRequestException('No se pueden registrar pagos en un préstamo anulado');
      }

      const chargeColumns = loan.chargeColumns || [];
      const derived = calculateLoanInstallmentDerived(installment, chargeColumns);

      if (derived.status === 'PAID') {
        throw new BadRequestException('Esta cuota ya fue pagada en su totalidad');
      }

      const allocatedPrincipal = roundMoney(parsed.allocatedPrincipal);
      if (allocatedPrincipal > derived.pendingPrincipal + 0.0001) {
        throw new BadRequestException(
          'El capital pagado no puede superar el capital pendiente de la cuota. Para amortizaciones extraordinarias usá "Editar préstamo".',
        );
      }

      const paymentAccount = await em.findOne(AccountEntity, {
        where: { id: parsed.paymentAccountId, userId },
      });
      if (!paymentAccount) {
        throw new NotFoundException('Cuenta de pago no encontrada');
      }
      if (paymentAccount.status === 'INACTIVE') {
        throw new BadRequestException(`La cuenta "${paymentAccount.name}" está inactiva`);
      }
      if (!paymentAccount.isCashOrBank || isControlAccount(paymentAccount)) {
        throw new BadRequestException(
          `La cuenta "${paymentAccount.name}" debe ser una cuenta líquida (efectivo o banco)`,
        );
      }

      const colById = new Map(chargeColumns.map((c) => [c.id, c]));
      const rateToBase =
        Number(loan.currency?.rateToBase || 1) > 0 ? Number(loan.currency.rateToBase) : 1;

      const entries: MultiEntryItem[] = [];
      const allocatedChargesJson: Record<string, number> = {};

      const principalBase = roundMoney(allocatedPrincipal * rateToBase);
      if (principalBase > 0) {
        entries.push({
          accountId: loan.liabilityAccountId,
          entryType: 'DEBIT',
          amountBase: principalBase,
        });
      }

      for (const [colId, rawVal] of Object.entries(parsed.allocatedCharges || {})) {
        const val = roundMoney(Number(rawVal || 0));
        if (val <= 0) continue;
        const col = colById.get(colId);
        if (!col) {
          throw new BadRequestException(`Columna de cargo desconocida: ${colId}`);
        }
        allocatedChargesJson[colId] = val;
        const chargeBase = roundMoney(val * rateToBase);
        if (chargeBase > 0) {
          entries.push({
            accountId: col.expenseAccountId,
            entryType: 'DEBIT',
            amountBase: chargeBase,
          });
        }
      }

      const totalBase = roundMoney(entries.reduce((sum, e) => sum + e.amountBase, 0));
      if (totalBase <= 0 || entries.length === 0) {
        throw new BadRequestException('El monto total del pago debe ser mayor a 0');
      }

      entries.push({
        accountId: paymentAccount.id,
        entryType: 'CREDIT',
        amountBase: totalBase,
      });

      const txDesc = `[Préstamo] Pago cuota #${installment.installmentNumber} · ${loan.name}`;
      const posted = await this.systemAccountService.postMultiEntry(em, userId, {
        accountingDate: parsed.paidAt,
        description: txDesc,
        entries,
        originModule: 'LOAN',
        originEntityId: loan.id,
      });

      const principalEntry =
        principalBase > 0
          ? posted.entries.find(
              (e) => e.accountId === loan.liabilityAccountId && e.entryType === 'DEBIT',
            ) || null
          : null;

      const savedAllocation = await em.save(
        LoanPaymentAllocationEntity,
        em.create(LoanPaymentAllocationEntity, {
          installmentId: installment.id,
          transactionId: posted.transaction.id,
          principalJournalEntryId: principalEntry ? principalEntry.id : null,
          allocatedPrincipal,
          allocatedChargesJson,
          paidAt: parsed.paidAt,
        }),
      );

      // Recalcular si todo el capital del préstamo quedó en 0 -> SETTLED
      const allInstallments =
        (await em.find(LoanInstallmentEntity, {
          where: { loanId: loan.id },
          relations: ['allocations', 'allocations.transaction'],
        })) || [];

      let totalPendingPrincipal = 0;
      for (const inst of allInstallments) {
        const allocs = [...(inst.allocations || [])];
        if (inst.id === installment.id && !allocs.some((a) => a.id === savedAllocation.id)) {
          allocs.push({ ...savedAllocation, transaction: posted.transaction });
        }
        const instDerived = calculateLoanInstallmentDerived(
          { ...inst, allocations: allocs },
          chargeColumns,
        );
        totalPendingPrincipal += instDerived.pendingPrincipal;
      }

      const nextStatus = roundMoney(totalPendingPrincipal) <= 0.0001 ? 'SETTLED' : 'ACTIVE';
      if (loan.status !== nextStatus) {
        loan.status = nextStatus;
        await em.save(LoanEntity, loan);
      }

      return loan.id;
    });

    return this.getLoansUseCase.getById(userId, loanId);
  }
}
