import {
  LoanDto,
  LoanInstallmentStatus,
  LoanPortfolioNextInstallmentDto,
  LoansKpiSummary,
  LoanStatus,
} from '@sistema-contable/shared';

export interface LoanAllocationRecordLike {
  id: string;
  installmentId: string;
  transactionId: string;
  principalJournalEntryId: string | null;
  allocatedPrincipal: number;
  allocatedChargesJson?: Record<string, number> | null;
  paidAt: string;
  createdAt?: Date | string;
  transaction?: { status?: string } | null;
}

export interface LoanChargeColumnRecordLike {
  id: string;
  name: string;
  expenseAccountId: string;
  isActive: boolean;
  sortOrder: number;
}

export interface LoanInstallmentRecordLike {
  id: string;
  loanId: string;
  installmentNumber: number;
  dueDate: string;
  principalAmount: number;
  chargesJson?: Record<string, number> | null;
  allocations?: LoanAllocationRecordLike[];
}

export interface DerivedLoanInstallmentResult {
  principalAmount: number;
  charges: Record<string, number>;
  paidPrincipal: number;
  pendingPrincipal: number;
  paidCharges: Record<string, number>;
  pendingCharges: Record<string, number>;
  scheduledTotal: number;
  paidTotal: number;
  pendingTotal: number;
  status: LoanInstallmentStatus;
  isOverdue: boolean;
  activeAllocations: LoanAllocationRecordLike[];
}

export interface DerivedLoanResult {
  paidPrincipal: number;
  pendingPrincipal: number;
  paidChargesTotal: number;
  totalPaid: number;
  progressPercent: number;
  paidInstallmentsCount: number;
  pendingInstallmentsCount: number;
  nextDueDate: string | null;
  nextInstallmentNumber: number | null;
  nextInstallmentPendingTotal: number;
  isNextOverdue: boolean;
  status: LoanStatus;
}

export interface FrenchAmortizationRow {
  installmentNumber: number;
  dueDate: string;
  principalAmount: number;
  interestAmount: number;
  balanceBefore: number;
}

export function roundMoney(value: number, decimals: number = 4): number {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(decimals));
}

export function getTodayIsoDate(timezoneOffsetMinutes?: number): string {
  if (typeof timezoneOffsetMinutes === 'number' && Number.isFinite(timezoneOffsetMinutes)) {
    const shifted = new Date(Date.now() - timezoneOffsetMinutes * 60_000);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const d = String(shifted.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addMonthsIsoDate(startIso: string, monthsToAdd: number): string {
  const match = String(startIso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return startIso;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  const base = new Date(Date.UTC(year, month - 1 + monthsToAdd, 1));
  const maxDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  const safeDay = Math.min(day, maxDay);

  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(
    safeDay,
  ).padStart(2, '0')}`;
}

/**
 * Calculadora de sistema francés para generar un borrador inicial o recalcular cuotas pendientes.
 * Garantiza que cada cuota tenga capital > 0 y que la suma de capitales coincida exactamente con principal.
 */
export function calculateFrenchAmortizationSchedule(params: {
  principal: number;
  annualRate: number;
  count: number;
  firstDueDate: string;
  startInstallmentNumber?: number;
  decimalPlaces?: number;
}): FrenchAmortizationRow[] {
  const count = Math.max(1, Math.floor(params.count));
  const decimals = Math.max(0, Math.min(4, params.decimalPlaces ?? 0));
  const factor = Math.pow(10, decimals);
  const principal = Math.max(1 / factor, roundMoney(params.principal, decimals));
  const annualRate = Math.max(0, Number(params.annualRate || 0));
  const startNum = Math.max(1, Math.floor(params.startInstallmentNumber ?? 1));

  const monthlyRate = annualRate / 100 / 12;
  const pmt =
    monthlyRate > 0
      ? (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -count))
      : principal / count;

  let remainingUnits = Math.round(principal * factor);
  const rows: FrenchAmortizationRow[] = [];

  for (let i = 0; i < count; i++) {
    const balanceBefore = roundMoney(remainingUnits / factor, decimals);
    const interestAmount = roundMoney(balanceBefore * monthlyRate, decimals);

    let principalUnits: number;
    if (i === count - 1) {
      principalUnits = Math.max(1, remainingUnits);
    } else {
      const remainingAfter = count - 1 - i;
      const maxAllowedUnits = Math.max(1, remainingUnits - remainingAfter);
      const rawUnits = Math.round((pmt - interestAmount) * factor);
      principalUnits = Math.min(maxAllowedUnits, Math.max(1, rawUnits));
    }

    remainingUnits = Math.max(0, remainingUnits - principalUnits);

    rows.push({
      installmentNumber: startNum + i,
      dueDate: addMonthsIsoDate(params.firstDueDate, i),
      principalAmount: roundMoney(principalUnits / factor, decimals),
      interestAmount,
      balanceBefore,
    });
  }

  return rows;
}

/**
 * Deriva estado, saldos pendientes y pagos reales de una cuota exclusivamente desde
 * loan_payment_allocations cuyas transacciones estén en estado POSTED.
 * Invariante Spec 02 §3.3: el estado (PAID / PARTIAL / PENDING) depende solo del capital.
 */
export function calculateLoanInstallmentDerived(
  installment: LoanInstallmentRecordLike,
  chargeColumns: LoanChargeColumnRecordLike[],
  todayIso: string = getTodayIsoDate(),
): DerivedLoanInstallmentResult {
  const principalAmount = roundMoney(Number(installment.principalAmount || 0));
  const rawCharges = installment.chargesJson || {};
  const rawAllocations = Array.isArray(installment.allocations) ? installment.allocations : [];

  const activeAllocations = rawAllocations.filter(
    (a) => !a.transaction || a.transaction.status === 'POSTED',
  );

  const paidPrincipal = roundMoney(
    activeAllocations.reduce((sum, a) => sum + Number(a.allocatedPrincipal || 0), 0),
  );
  const rawPendingPrincipal = roundMoney(principalAmount - paidPrincipal);
  const pendingPrincipal = rawPendingPrincipal <= 0.0001 ? 0 : rawPendingPrincipal;

  const charges: Record<string, number> = {};
  const paidCharges: Record<string, number> = {};
  const pendingCharges: Record<string, number> = {};

  const knownColIds = new Set<string>();
  for (const col of chargeColumns) {
    knownColIds.add(col.id);
    const scheduled = roundMoney(Number(rawCharges[col.id] || 0));
    const paid = roundMoney(
      activeAllocations.reduce(
        (sum, a) => sum + Number((a.allocatedChargesJson || {})[col.id] || 0),
        0,
      ),
    );
    const rawPending = roundMoney(scheduled - paid);
    charges[col.id] = scheduled;
    paidCharges[col.id] = paid;
    pendingCharges[col.id] = rawPending <= 0.0001 ? 0 : rawPending;
  }

  for (const [colId, val] of Object.entries(rawCharges)) {
    if (!knownColIds.has(colId)) {
      const scheduled = roundMoney(Number(val || 0));
      charges[colId] = scheduled;
      const paid = roundMoney(
        activeAllocations.reduce(
          (sum, a) => sum + Number((a.allocatedChargesJson || {})[colId] || 0),
          0,
        ),
      );
      paidCharges[colId] = paid;
      const rawPending = roundMoney(scheduled - paid);
      pendingCharges[colId] = rawPending <= 0.0001 ? 0 : rawPending;
    }
  }

  for (const alloc of activeAllocations) {
    for (const [colId, val] of Object.entries(alloc.allocatedChargesJson || {})) {
      if (!(colId in paidCharges)) {
        paidCharges[colId] = roundMoney(Number(val || 0));
      }
    }
  }

  const activeColumnIds = new Set(chargeColumns.filter((c) => c.isActive).map((c) => c.id));
  const scheduledChargesSum = Object.entries(charges).reduce(
    (sum, [colId, amt]) => sum + (activeColumnIds.has(colId) || amt > 0 ? amt : 0),
    0,
  );
  const paidChargesSum = Object.values(paidCharges).reduce((sum, amt) => sum + amt, 0);
  const pendingChargesSum = Object.entries(pendingCharges).reduce(
    (sum, [colId, amt]) => sum + (activeColumnIds.has(colId) ? amt : 0),
    0,
  );

  const scheduledTotal = roundMoney(principalAmount + scheduledChargesSum);
  const paidTotal = roundMoney(paidPrincipal + paidChargesSum);
  const pendingTotal = roundMoney(pendingPrincipal + pendingChargesSum);

  const isPaidByCapital = pendingPrincipal === 0;
  const isPartialByCapital = !isPaidByCapital && paidPrincipal > 0.0001;
  const isOverdue = !isPaidByCapital && String(installment.dueDate) < todayIso;

  let status: LoanInstallmentStatus;
  if (isPaidByCapital) {
    status = 'PAID';
  } else if (isPartialByCapital) {
    status = 'PARTIAL';
  } else if (isOverdue) {
    status = 'OVERDUE';
  } else {
    status = 'PENDING';
  }

  return {
    principalAmount,
    charges,
    paidPrincipal,
    pendingPrincipal,
    paidCharges,
    pendingCharges,
    scheduledTotal,
    paidTotal,
    pendingTotal,
    status,
    isOverdue,
    activeAllocations,
  };
}

export function calculateLoanDerived(
  persistedStatus: LoanStatus,
  installments: Array<{
    installmentNumber: number;
    dueDate: string;
    paidPrincipal: number;
    pendingPrincipal: number;
    paidTotal: number;
    pendingTotal: number;
    status: LoanInstallmentStatus;
    isOverdue: boolean;
  }>,
): DerivedLoanResult {
  const paidPrincipal = roundMoney(installments.reduce((sum, i) => sum + i.paidPrincipal, 0));
  const rawPendingPrincipal = roundMoney(
    installments.reduce((sum, i) => sum + i.pendingPrincipal, 0),
  );
  const pendingPrincipal = rawPendingPrincipal <= 0.0001 ? 0 : rawPendingPrincipal;

  const totalPaid = roundMoney(installments.reduce((sum, i) => sum + i.paidTotal, 0));
  const paidChargesTotal = roundMoney(Math.max(0, totalPaid - paidPrincipal));

  const totalScheduledCapital = roundMoney(paidPrincipal + pendingPrincipal);
  const progressPercent =
    totalScheduledCapital > 0
      ? Math.min(100, Math.round((paidPrincipal / totalScheduledCapital) * 100))
      : 0;

  const paidRows = installments.filter((i) => i.status === 'PAID');
  const pendingRows = installments
    .filter((i) => i.status !== 'PAID')
    .sort(
      (a, b) => a.dueDate.localeCompare(b.dueDate) || a.installmentNumber - b.installmentNumber,
    );

  const next = pendingRows[0] || null;
  const derivedStatus: LoanStatus =
    persistedStatus === 'CANCELLED' ? 'CANCELLED' : pendingPrincipal === 0 ? 'SETTLED' : 'ACTIVE';

  return {
    paidPrincipal,
    pendingPrincipal,
    paidChargesTotal,
    totalPaid,
    progressPercent,
    paidInstallmentsCount: paidRows.length,
    pendingInstallmentsCount: pendingRows.length,
    nextDueDate: next ? next.dueDate : null,
    nextInstallmentNumber: next ? next.installmentNumber : null,
    nextInstallmentPendingTotal: next ? next.pendingTotal : 0,
    isNextOverdue: next ? next.isOverdue : false,
    status: derivedStatus,
  };
}

export function computeLoansKpis(loans: LoanDto[]): LoansKpiSummary {
  let totalPendingPrincipalBase = 0;
  let monthlyLoadBase = 0;
  let activeLoansCount = 0;
  let settledLoansCount = 0;
  let pendingInstallmentsCount = 0;
  let paidInstallmentsCount = 0;
  let nextInstallment: LoanPortfolioNextInstallmentDto | null = null;

  for (const loan of loans) {
    if (loan.status === 'CANCELLED') continue;

    const rate = Number(loan.rateToBase || 1) || 1;
    totalPendingPrincipalBase += loan.pendingPrincipal * rate;
    paidInstallmentsCount += loan.paidInstallmentsCount;
    pendingInstallmentsCount += loan.pendingInstallmentsCount;

    if (loan.status === 'SETTLED') {
      settledLoansCount += 1;
      continue;
    }

    activeLoansCount += 1;
    const nextInst = loan.installments
      .filter((i) => i.status !== 'PAID')
      .sort(
        (a, b) => a.dueDate.localeCompare(b.dueDate) || a.installmentNumber - b.installmentNumber,
      )[0];

    if (nextInst) {
      const pendingBase = roundMoney(nextInst.pendingTotal * rate);
      monthlyLoadBase += pendingBase;

      if (
        !nextInstallment ||
        nextInst.dueDate.localeCompare(nextInstallment.dueDate) < 0 ||
        (nextInst.dueDate === nextInstallment.dueDate &&
          nextInst.installmentNumber < nextInstallment.installmentNumber)
      ) {
        nextInstallment = {
          loanId: loan.id,
          loanName: loan.name,
          installmentId: nextInst.id,
          installmentNumber: nextInst.installmentNumber,
          dueDate: nextInst.dueDate,
          pendingTotal: nextInst.pendingTotal,
          pendingTotalBase: pendingBase,
          currencyCode: loan.currencyCode,
          currencySymbol: loan.currencySymbol,
          decimalPlaces: loan.decimalPlaces,
          isOverdue: nextInst.isOverdue,
        };
      }
    }
  }

  return {
    totalPendingPrincipalBase: roundMoney(totalPendingPrincipalBase),
    monthlyLoadBase: roundMoney(monthlyLoadBase),
    activeLoansCount,
    settledLoansCount,
    pendingInstallmentsCount,
    paidInstallmentsCount,
    nextInstallment,
  };
}
