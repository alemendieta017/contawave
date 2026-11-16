import {
  CommitmentFlowDirection,
  CommitmentOriginType,
  CommitmentStatus,
  SettlementType,
} from '@sistema-contable/shared';

export interface SettlementRecordLike {
  id: string;
  installmentId: string;
  transactionId: string;
  journalEntryId: string;
  settlementType: SettlementType;
  amount: number;
  settledAt: string;
  createdAt?: Date | string;
  transaction?: { status?: string } | null;
}

export interface InstallmentRecordLike {
  id: string;
  commitmentId: string;
  installmentNumber: number;
  dueDate: string | null;
  amount: number;
  settlements?: SettlementRecordLike[];
}

export interface DerivedInstallmentResult {
  amount: number;
  settledAmount: number;
  pendingAmount: number;
  status: CommitmentStatus;
  activeSettlements: SettlementRecordLike[];
}

export interface DerivedCommitmentResult {
  totalAmount: number;
  settledAmount: number;
  pendingAmount: number;
  status: CommitmentStatus;
  hasNoDateInstallments: boolean;
  nextDueDate: string | null;
}

export function roundMoney(value: number): number {
  return Number(Number(value || 0).toFixed(4));
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

export function buildCommitmentTransactionDescription(
  direction: CommitmentFlowDirection,
  contactName: string,
  description: string,
): string {
  const prefix = direction === 'INFLOW' ? '[Cuentas por cobrar]' : '[Cuentas por pagar]';
  return `${prefix} ${contactName} — ${description.trim()}`;
}

/**
 * Calcula dinámicamente el estado y saldos de una cuota a partir de liquidaciones POSTED.
 * Regla crítica: una cuota sin dueDate (dueDate === null) jamás pasa a estado OVERDUE.
 */
export function calculateInstallmentDerived(
  installment: InstallmentRecordLike,
  today: string = getTodayIsoDate(),
): DerivedInstallmentResult {
  const totalAmount = roundMoney(Number(installment.amount));
  const rawSettlements = Array.isArray(installment.settlements) ? installment.settlements : [];

  const activeSettlements = rawSettlements.filter(
    (s) => !s.transaction || s.transaction.status === 'POSTED',
  );

  const settledAmount = roundMoney(
    activeSettlements.reduce((sum, s) => sum + Number(s.amount || 0), 0),
  );
  const rawPending = roundMoney(totalAmount - settledAmount);
  const pendingAmount = rawPending <= 0.0001 ? 0 : rawPending;

  let status: CommitmentStatus;
  if (pendingAmount === 0) {
    status = 'PAID';
  } else if (installment.dueDate !== null && installment.dueDate < today) {
    status = 'OVERDUE';
  } else if (settledAmount > 0.0001) {
    status = 'PARTIAL';
  } else {
    status = 'PENDING';
  }

  return {
    amount: totalAmount,
    settledAmount,
    pendingAmount,
    status,
    activeSettlements,
  };
}

/**
 * Calcula dinámicamente el estado agregado de un compromiso a partir de sus cuotas derivadas.
 */
export function calculateCommitmentDerived(
  totalAmountRaw: number,
  installments: Array<{
    dueDate: string | null;
    settledAmount: number;
    pendingAmount: number;
    status: CommitmentStatus;
  }>,
): DerivedCommitmentResult {
  const totalAmount = roundMoney(Number(totalAmountRaw));
  const settledAmount = roundMoney(installments.reduce((sum, i) => sum + i.settledAmount, 0));
  const rawPending = roundMoney(installments.reduce((sum, i) => sum + i.pendingAmount, 0));
  const pendingAmount = rawPending <= 0.0001 ? 0 : rawPending;

  const hasNoDateInstallments = installments.some((i) => i.pendingAmount > 0 && i.dueDate === null);

  const pendingDates = installments
    .filter((i) => i.pendingAmount > 0 && i.dueDate !== null)
    .map((i) => i.dueDate as string)
    .sort((a, b) => a.localeCompare(b));
  const nextDueDate = pendingDates.length > 0 ? pendingDates[0] : null;

  let status: CommitmentStatus;
  if (pendingAmount === 0) {
    status = 'PAID';
  } else if (installments.some((i) => i.pendingAmount > 0 && i.status === 'OVERDUE')) {
    status = 'OVERDUE';
  } else if (settledAmount > 0.0001) {
    status = 'PARTIAL';
  } else {
    status = 'PENDING';
  }

  return {
    totalAmount,
    settledAmount,
    pendingAmount,
    status,
    hasNoDateInstallments,
    nextDueDate,
  };
}

/**
 * Genera una etiqueta humana y libre de jerga contable para mostrar el origen del compromiso.
 */
export function buildOriginBadgeText(
  originType: CommitmentOriginType,
  categoryAccountName?: string | null,
  cashAccountName?: string | null,
): string {
  if (originType === 'CATEGORY') {
    return categoryAccountName || 'Categoría';
  }
  if (originType === 'CASH_TRANSFER') {
    return cashAccountName ? `Préstamo de dinero · ${cashAccountName}` : 'Préstamo de dinero';
  }
  return 'Ajuste patrimonial';
}
