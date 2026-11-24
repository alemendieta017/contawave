import {
  LoanChargeColumnDto,
  LoanDto,
  LoanInstallmentDto,
  LoanPaymentAllocationDto,
} from '@sistema-contable/shared';
import {
  calculateLoanDerived,
  calculateLoanInstallmentDerived,
  getTodayIsoDate,
  roundMoney,
} from '../../domain/loans/loan-calculator';
import { LoanEntity } from '../../infrastructure/database/entities/loan.entity';

export interface LoanMappingMeta {
  activeAdjustmentsCount?: number;
  hasExtraHistory?: boolean;
}

export function mapLoanToDto(
  entity: LoanEntity,
  todayIso: string = getTodayIsoDate(),
  meta: LoanMappingMeta = {},
): LoanDto {
  const sortedCols = [...(entity.chargeColumns || [])].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
  const sortedInstallments = [...(entity.installments || [])].sort(
    (a, b) => a.installmentNumber - b.installmentNumber,
  );

  const colHasActiveAllocations = new Map<string, boolean>();
  for (const col of sortedCols) {
    colHasActiveAllocations.set(col.id, false);
  }

  let activeAllocationsCount = 0;
  let totalAllocationsCount = 0;

  const mappedInstallments: LoanInstallmentDto[] = sortedInstallments.map((inst) => {
    const rawAllocations = inst.allocations || [];
    totalAllocationsCount += rawAllocations.length;

    const derivedInst = calculateLoanInstallmentDerived(inst, sortedCols, todayIso);
    activeAllocationsCount += derivedInst.activeAllocations.length;

    for (const activeAlloc of derivedInst.activeAllocations) {
      for (const [colId, amt] of Object.entries(activeAlloc.allocatedChargesJson || {})) {
        if (Number(amt || 0) > 0) {
          colHasActiveAllocations.set(colId, true);
        }
      }
    }

    const mappedAllocations: LoanPaymentAllocationDto[] = derivedInst.activeAllocations
      .slice()
      .sort((a, b) => String(a.paidAt).localeCompare(String(b.paidAt)))
      .map((a) => {
        const rawAlloc = rawAllocations.find((orig) => orig.id === a.id);
        const creditEntry = rawAlloc?.transaction?.entries?.find((e) => e.entryType === 'CREDIT');
        const chargesMap: Record<string, number> = {};
        let chargesSum = 0;
        for (const [colId, val] of Object.entries(a.allocatedChargesJson || {})) {
          const rounded = roundMoney(Number(val || 0));
          chargesMap[colId] = rounded;
          chargesSum += rounded;
        }
        const principal = roundMoney(Number(a.allocatedPrincipal || 0));
        return {
          id: a.id,
          installmentId: a.installmentId,
          transactionId: a.transactionId,
          principalJournalEntryId: a.principalJournalEntryId ?? null,
          allocatedPrincipal: principal,
          allocatedCharges: chargesMap,
          totalAmount: roundMoney(principal + chargesSum),
          paidAt: String(a.paidAt),
          paymentAccountId: creditEntry?.accountId ?? null,
          paymentAccountName: creditEntry?.account?.name ?? null,
          createdAt:
            a.createdAt instanceof Date
              ? a.createdAt.toISOString()
              : String(a.createdAt || a.paidAt),
        };
      });

    return {
      id: inst.id,
      loanId: inst.loanId,
      installmentNumber: inst.installmentNumber,
      dueDate: String(inst.dueDate),
      principalAmount: derivedInst.principalAmount,
      charges: derivedInst.charges,
      paidPrincipal: derivedInst.paidPrincipal,
      pendingPrincipal: derivedInst.pendingPrincipal,
      paidCharges: derivedInst.paidCharges,
      pendingCharges: derivedInst.pendingCharges,
      scheduledTotal: derivedInst.scheduledTotal,
      paidTotal: derivedInst.paidTotal,
      pendingTotal: derivedInst.pendingTotal,
      status: derivedInst.status,
      isOverdue: derivedInst.isOverdue,
      allocations: mappedAllocations,
    };
  });

  const mappedColumns: LoanChargeColumnDto[] = sortedCols.map((col) => ({
    id: col.id,
    name: col.name,
    expenseAccountId: col.expenseAccountId,
    expenseAccountName: col.expenseAccount?.name || 'Categoría de gasto',
    isActive: col.isActive !== false,
    sortOrder: col.sortOrder,
    hasAllocations: Boolean(colHasActiveAllocations.get(col.id)),
  }));

  const derivedLoan = calculateLoanDerived(entity.status, mappedInstallments);

  const initialTransaction = entity.initialTransaction
    ? {
        id: entity.initialTransaction.id,
        accountingDate: String(entity.initialTransaction.accountingDate),
        description: entity.initialTransaction.description,
        status: entity.initialTransaction.status,
        entries: (entity.initialTransaction.entries || []).map((e) => ({
          accountId: e.accountId,
          accountName: e.account?.name || 'Cuenta',
          entryType: e.entryType,
          amount: roundMoney(Number(e.amountBase || e.amount)),
        })),
      }
    : null;

  const activeAdjustmentsCount = meta.activeAdjustmentsCount ?? 0;
  const activeMovementsCount = activeAllocationsCount + activeAdjustmentsCount;
  const hasAnyHistory =
    Boolean(meta.hasExtraHistory) ||
    totalAllocationsCount > 0 ||
    entity.initialTransaction?.status === 'REVERSED';

  const deleteActionPreview: 'DELETE' | 'CANCEL' | 'BLOCKED' =
    activeMovementsCount > 0 ? 'BLOCKED' : hasAnyHistory ? 'CANCEL' : 'DELETE';

  return {
    id: entity.id,
    name: entity.name,
    currencyId: entity.currencyId,
    currencyCode: entity.currency?.code || 'PYG',
    currencySymbol: entity.currency?.symbol || '₲',
    decimalPlaces: entity.currency?.decimalPlaces ?? 0,
    rateToBase: Number(entity.currency?.rateToBase ?? 1),
    initialPrincipal: roundMoney(Number(entity.initialPrincipal || 0)),
    annualRate: Number(entity.annualRate || 0),
    openingDate: String(entity.openingDate),
    startInstallmentNumber: entity.startInstallmentNumber,
    totalInstallmentsCount: entity.totalInstallmentsCount,
    liabilityAccountId: entity.liabilityAccountId,
    liabilityAccountName: entity.liabilityAccount?.name || entity.name,
    defaultPaymentAccountId: entity.defaultPaymentAccountId ?? null,
    defaultPaymentAccountName: entity.defaultPaymentAccount?.name ?? null,
    initialTransactionId: entity.initialTransactionId,
    initialTransaction,
    status: derivedLoan.status,
    paidPrincipal: derivedLoan.paidPrincipal,
    pendingPrincipal: derivedLoan.pendingPrincipal,
    paidChargesTotal: derivedLoan.paidChargesTotal,
    totalPaid: derivedLoan.totalPaid,
    progressPercent: derivedLoan.progressPercent,
    paidInstallmentsCount: derivedLoan.paidInstallmentsCount,
    pendingInstallmentsCount: derivedLoan.pendingInstallmentsCount,
    nextDueDate: derivedLoan.nextDueDate,
    nextInstallmentNumber: derivedLoan.nextInstallmentNumber,
    nextInstallmentPendingTotal: derivedLoan.nextInstallmentPendingTotal,
    isNextOverdue: derivedLoan.isNextOverdue,
    activeMovementsCount,
    deleteActionPreview,
    chargeColumns: mappedColumns,
    installments: mappedInstallments,
    createdAt:
      entity.createdAt instanceof Date
        ? entity.createdAt.toISOString()
        : String(entity.createdAt || ''),
  };
}
