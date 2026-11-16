import {
  CommitmentDto,
  CommitmentInstallmentDto,
  CommitmentKpiSummary,
  CommitmentSettlementDto,
} from '@sistema-contable/shared';
import {
  buildOriginBadgeText,
  calculateCommitmentDerived,
  calculateInstallmentDerived,
  getTodayIsoDate,
  roundMoney,
} from '../../domain/commitments/commitment-calculator';
import { CommitmentEntity } from '../../infrastructure/database/entities/commitment.entity';

export function mapCommitmentToDto(
  entity: CommitmentEntity,
  today: string = getTodayIsoDate(),
): CommitmentDto {
  const sortedInstallments = [...(entity.installments || [])].sort(
    (a, b) => a.installmentNumber - b.installmentNumber,
  );

  const mappedInstallments: CommitmentInstallmentDto[] = sortedInstallments.map((inst) => {
    const derivedInst = calculateInstallmentDerived(inst, today);
    const activeSettlements: CommitmentSettlementDto[] = derivedInst.activeSettlements
      .slice()
      .sort((a, b) => String(a.settledAt).localeCompare(String(b.settledAt)))
      .map((s) => {
        const rawSettlement = inst.settlements?.find((orig) => orig.id === s.id);
        return {
          id: s.id,
          installmentId: s.installmentId,
          transactionId: s.transactionId,
          journalEntryId: s.journalEntryId,
          settlementType: s.settlementType,
          amount: roundMoney(Number(s.amount)),
          settledAt: String(s.settledAt),
          createdAt:
            s.createdAt instanceof Date
              ? s.createdAt.toISOString()
              : String(s.createdAt || s.settledAt),
          cashAccountId:
            s.settlementType === 'CASH' ? (rawSettlement?.journalEntry?.accountId ?? null) : null,
          cashAccountName:
            s.settlementType === 'CASH'
              ? (rawSettlement?.journalEntry?.account?.name ?? null)
              : null,
        };
      });

    return {
      id: inst.id,
      commitmentId: inst.commitmentId,
      installmentNumber: inst.installmentNumber,
      dueDate: inst.dueDate ? String(inst.dueDate) : null,
      amount: derivedInst.amount,
      settledAmount: derivedInst.settledAmount,
      pendingAmount: derivedInst.pendingAmount,
      status: derivedInst.status,
      settlements: activeSettlements,
    };
  });

  const derivedCom = calculateCommitmentDerived(entity.totalAmount, mappedInstallments);

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

  return {
    id: entity.id,
    contactId: entity.contactId,
    contactName: entity.contact?.name || 'Contacto',
    direction: entity.direction,
    originType: entity.originType,
    originBadgeText: buildOriginBadgeText(
      entity.originType,
      entity.categoryAccount?.name || null,
      entity.cashAccount?.name || null,
    ),
    description: entity.description,
    notes: entity.notes ?? null,
    totalAmount: derivedCom.totalAmount,
    settledAmount: derivedCom.settledAmount,
    pendingAmount: derivedCom.pendingAmount,
    status: derivedCom.status,
    hasNoDateInstallments: derivedCom.hasNoDateInstallments,
    nextDueDate: derivedCom.nextDueDate,
    categoryAccountId: entity.categoryAccountId ?? null,
    categoryAccountName: entity.categoryAccount?.name ?? null,
    cashAccountId: entity.cashAccountId ?? null,
    cashAccountName: entity.cashAccount?.name ?? null,
    controlAccountId: entity.controlAccountId,
    controlAccountName: entity.controlAccount?.name || 'Cuenta de Control',
    initialTransactionId: entity.initialTransactionId,
    initialTransaction,
    createdAt:
      entity.createdAt instanceof Date
        ? entity.createdAt.toISOString()
        : String(entity.createdAt || ''),
    installments: mappedInstallments,
  };
}

export function computeCommitmentsKpis(commitments: CommitmentDto[]): CommitmentKpiSummary {
  let receivableTotal = 0;
  let payableTotal = 0;
  let receivableInstallmentsCount = 0;
  let overdueReceivableCount = 0;
  let overduePayableCount = 0;
  let noDateCount = 0;
  let payableInstallmentsCount = 0;
  const payableDueDates: string[] = [];

  for (const c of commitments) {
    if (c.direction === 'INFLOW') {
      receivableTotal += c.pendingAmount;
    } else {
      payableTotal += c.pendingAmount;
    }

    for (const inst of c.installments) {
      if (inst.pendingAmount <= 0) continue;

      if (inst.dueDate === null) {
        noDateCount += 1;
      }

      if (c.direction === 'INFLOW') {
        receivableInstallmentsCount += 1;
        if (inst.status === 'OVERDUE') {
          overdueReceivableCount += 1;
        }
      } else {
        payableInstallmentsCount += 1;
        if (inst.status === 'OVERDUE') {
          overduePayableCount += 1;
        }
        if (inst.dueDate) {
          payableDueDates.push(inst.dueDate);
        }
      }
    }
  }

  payableDueDates.sort((a, b) => a.localeCompare(b));

  const rec = roundMoney(receivableTotal);
  const pay = roundMoney(payableTotal);

  return {
    receivableTotal: rec,
    payableTotal: pay,
    netBalance: roundMoney(rec - pay),
    receivableInstallmentsCount,
    overdueReceivableCount,
    overduePayableCount,
    noDateCount,
    payableInstallmentsCount,
    nextPayableDueDate: payableDueDates.length > 0 ? payableDueDates[0] : null,
  };
}
