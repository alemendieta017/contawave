import { EntityManager } from 'typeorm';
import { AccountEntity } from '../../entities/account.entity';
import { PeriodEntity } from '../../entities/period.entity';
import { ContactEntity } from '../../entities/contact.entity';
import { CommitmentEntity } from '../../entities/commitment.entity';
import { CommitmentInstallmentEntity } from '../../entities/commitment-installment.entity';
import { CommitmentSettlementEntity } from '../../entities/commitment-settlement.entity';
import { BalanceUpdateService } from '../../../../application/periods/balance-update.service';
import {
  buildCommitmentTransactionDescription,
  getTodayIsoDate,
} from '../../../../domain/commitments/commitment-calculator';
import { LedgerBuilder } from './ledger-builder';

function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().split('T')[0];
}

function clampToPeriods(
  candidate: string,
  periods: PeriodEntity[],
  fallbackPeriod: PeriodEntity,
): string {
  const matching = periods.find(
    (p) => candidate >= String(p.startDate) && candidate <= String(p.endDate),
  );
  if (matching) return candidate;
  const targetDay = candidate.slice(8, 10);
  const start = String(fallbackPeriod.startDate);
  const end = String(fallbackPeriod.endDate);
  const combined = `${start.slice(0, 7)}-${targetDay}`;
  return combined > end ? end : combined < start ? start : combined;
}

export async function seedDefaultCommitments(
  em: EntityManager,
  userId: string,
  accountMap: Map<string, AccountEntity>,
  builder: LedgerBuilder,
  balanceUpdateService: BalanceUpdateService,
): Promise<void> {
  const periods = await em.find(PeriodEntity, {
    where: { userId },
    order: { startDate: 'ASC' },
  });
  if (periods.length === 0) return;

  const todayIso = getTodayIsoDate();
  let currentIdx = periods.findIndex(
    (p) => String(p.startDate) <= todayIso && todayIso <= String(p.endDate),
  );
  if (currentIdx === -1) {
    currentIdx = Math.min(Math.floor(periods.length / 2), periods.length - 1);
  }
  const prevIdx = Math.max(0, currentIdx - 1);
  const nextIdx = Math.min(periods.length - 1, currentIdx + 1);
  const prevPeriod = periods[prevIdx];
  const currentPeriod = periods[currentIdx];
  const nextPeriod = periods[nextIdx];

  const acctBanco = accountMap.get('Banco Principal');
  const acctAr = accountMap.get('Cuentas por Cobrar');
  const acctAp = accountMap.get('Cuentas por Pagar');
  const acctCapital = accountMap.get('Capital');
  const acctIngresosExtra = accountMap.get('Ingresos Extra');
  const acctServicios = accountMap.get('Servicios');

  if (!acctBanco || !acctAr || !acctAp || !acctCapital || !acctIngresosExtra || !acctServicios) {
    return;
  }

  const contactJose = await em.save(
    ContactEntity,
    em.create(ContactEntity, {
      userId,
      name: 'Don José Gómez',
      notes: 'Cliente habitual de desarrollo y mantenimiento web',
    }),
  );
  const contactJuan = await em.save(
    ContactEntity,
    em.create(ContactEntity, {
      userId,
      name: 'Juan Pérez',
      notes: 'Préstamo personal en cuotas mensuales',
    }),
  );
  const contactAndres = await em.save(
    ContactEntity,
    em.create(ContactEntity, {
      userId,
      name: 'Andrés Martínez',
      notes: 'Proveedor de infraestructura y soporte cloud',
    }),
  );

  // 1. Préstamo otorgado a Juan Pérez (INFLOW, CASH_TRANSFER) - 1 cuota saldada, 2 pendientes
  const loanOriginDate = String(prevPeriod.startDate).slice(0, 7) + '-05';
  const loanTx = await builder.createTransaction({
    description: buildCommitmentTransactionDescription(
      'INFLOW',
      contactJuan.name,
      'Préstamo personal a Juan Pérez',
    ),
    accountingDate: loanOriginDate,
    entries: [
      { accountId: acctAr.id, debit: 1500000, credit: 0 },
      { accountId: acctBanco.id, debit: 0, credit: 1500000 },
    ],
  });
  await balanceUpdateService.updateBalances(em, userId, loanOriginDate, [
    { accountId: acctAr.id, debitDiff: 1500000, creditDiff: 0 },
    { accountId: acctBanco.id, debitDiff: 0, creditDiff: 1500000 },
  ]);

  const c1 = await em.save(
    CommitmentEntity,
    em.create(CommitmentEntity, {
      userId,
      contactId: contactJuan.id,
      direction: 'INFLOW',
      originType: 'CASH_TRANSFER',
      description: 'Préstamo personal a Juan Pérez',
      notes: 'Acordado en 3 cuotas mensuales sin interés',
      totalAmount: 1500000,
      categoryAccountId: null,
      cashAccountId: acctBanco.id,
      controlAccountId: acctAr.id,
      initialTransactionId: loanTx.id,
    }),
  );

  const c1Due1 = String(prevPeriod.startDate).slice(0, 7) + '-25';
  const c1Due2 = clampToPeriods(addDaysIso(todayIso, 5), periods, currentPeriod);
  const c1Due3 = String(nextPeriod.startDate).slice(0, 7) + '-20';

  const c1Inst1 = await em.save(
    CommitmentInstallmentEntity,
    em.create(CommitmentInstallmentEntity, {
      commitmentId: c1.id,
      installmentNumber: 1,
      dueDate: c1Due1,
      amount: 500000,
    }),
  );
  await em.save(CommitmentInstallmentEntity, [
    em.create(CommitmentInstallmentEntity, {
      commitmentId: c1.id,
      installmentNumber: 2,
      dueDate: c1Due2,
      amount: 500000,
    }),
    em.create(CommitmentInstallmentEntity, {
      commitmentId: c1.id,
      installmentNumber: 3,
      dueDate: c1Due3,
      amount: 500000,
    }),
  ]);

  const c1SettleDate = String(prevPeriod.startDate).slice(0, 7) + '-28';
  const c1SettleTx = await builder.createTransaction({
    description: 'Cobro Cuota 1 - Préstamo personal a Juan Pérez',
    accountingDate: c1SettleDate,
    entries: [
      { accountId: acctBanco.id, debit: 500000, credit: 0 },
      { accountId: acctAr.id, debit: 0, credit: 500000 },
    ],
  });
  await balanceUpdateService.updateBalances(em, userId, c1SettleDate, [
    { accountId: acctBanco.id, debitDiff: 500000, creditDiff: 0 },
    { accountId: acctAr.id, debitDiff: 0, creditDiff: 500000 },
  ]);
  const c1SettleJe =
    c1SettleTx.entries.find((e) => e.entryType === 'DEBIT') || c1SettleTx.entries[0];
  await em.save(
    CommitmentSettlementEntity,
    em.create(CommitmentSettlementEntity, {
      installmentId: c1Inst1.id,
      transactionId: c1SettleTx.id,
      journalEntryId: c1SettleJe.id,
      settlementType: 'CASH',
      amount: 500000,
      settledAt: c1SettleDate,
    }),
  );

  // 2. Servicio facturado a crédito (INFLOW, CATEGORY) - 1 cuota vencida + 1 futura
  const webOriginDate = String(prevPeriod.startDate).slice(0, 7) + '-12';
  const webTx = await builder.createTransaction({
    description: buildCommitmentTransactionDescription(
      'INFLOW',
      contactJose.name,
      'Diseño de sitio web corporativo',
    ),
    accountingDate: webOriginDate,
    entries: [
      { accountId: acctAr.id, debit: 2400000, credit: 0 },
      { accountId: acctIngresosExtra.id, debit: 0, credit: 2400000 },
    ],
  });
  await balanceUpdateService.updateBalances(em, userId, webOriginDate, [
    { accountId: acctAr.id, debitDiff: 2400000, creditDiff: 0 },
    { accountId: acctIngresosExtra.id, debitDiff: 0, creditDiff: 2400000 },
  ]);

  const c2 = await em.save(
    CommitmentEntity,
    em.create(CommitmentEntity, {
      userId,
      contactId: contactJose.id,
      direction: 'INFLOW',
      originType: 'CATEGORY',
      description: 'Diseño de sitio web corporativo',
      notes: 'Entrega en dos hitos con factura crédito',
      totalAmount: 2400000,
      categoryAccountId: acctIngresosExtra.id,
      cashAccountId: null,
      controlAccountId: acctAr.id,
      initialTransactionId: webTx.id,
    }),
  );
  const c2Due1 = clampToPeriods(addDaysIso(todayIso, -3), periods, currentPeriod);
  const c2Due2 = String(nextPeriod.startDate).slice(0, 7) + '-15';
  await em.save(CommitmentInstallmentEntity, [
    em.create(CommitmentInstallmentEntity, {
      commitmentId: c2.id,
      installmentNumber: 1,
      dueDate: c2Due1,
      amount: 1200000,
    }),
    em.create(CommitmentInstallmentEntity, {
      commitmentId: c2.id,
      installmentNumber: 2,
      dueDate: c2Due2,
      amount: 1200000,
    }),
  ]);

  // 3. Compromiso por pagar programado (OUTFLOW, CATEGORY)
  const cloudOriginDate = clampToPeriods(addDaysIso(todayIso, -2), periods, currentPeriod);
  const cloudTx = await builder.createTransaction({
    description: buildCommitmentTransactionDescription(
      'OUTFLOW',
      contactAndres.name,
      'Renovación servidores y soporte técnico',
    ),
    accountingDate: cloudOriginDate,
    entries: [
      { accountId: acctServicios.id, debit: 900000, credit: 0 },
      { accountId: acctAp.id, debit: 0, credit: 900000 },
    ],
  });
  await balanceUpdateService.updateBalances(em, userId, cloudOriginDate, [
    { accountId: acctServicios.id, debitDiff: 900000, creditDiff: 0 },
    { accountId: acctAp.id, debitDiff: 0, creditDiff: 900000 },
  ]);

  const c3 = await em.save(
    CommitmentEntity,
    em.create(CommitmentEntity, {
      userId,
      contactId: contactAndres.id,
      direction: 'OUTFLOW',
      originType: 'CATEGORY',
      description: 'Renovación servidores y soporte técnico',
      notes: 'Dos pagos bimestrales',
      totalAmount: 900000,
      categoryAccountId: acctServicios.id,
      cashAccountId: null,
      controlAccountId: acctAp.id,
      initialTransactionId: cloudTx.id,
    }),
  );
  const c3Due1 = clampToPeriods(addDaysIso(todayIso, 8), periods, currentPeriod);
  const c3Due2 = String(nextPeriod.startDate).slice(0, 7) + '-23';
  await em.save(CommitmentInstallmentEntity, [
    em.create(CommitmentInstallmentEntity, {
      commitmentId: c3.id,
      installmentNumber: 1,
      dueDate: c3Due1,
      amount: 450000,
    }),
    em.create(CommitmentInstallmentEntity, {
      commitmentId: c3.id,
      installmentNumber: 2,
      dueDate: c3Due2,
      amount: 450000,
    }),
  ]);

  // 4. Saldo anterior abierto sin fecha definida (INFLOW, CAPITAL_ADJUSTMENT)
  const openOriginDate = String(prevPeriod.startDate).slice(0, 7) + '-02';
  const openTx = await builder.createTransaction({
    description: buildCommitmentTransactionDescription(
      'INFLOW',
      contactJose.name,
      'Saldo previo acordado por consultoría',
    ),
    accountingDate: openOriginDate,
    entries: [
      { accountId: acctAr.id, debit: 500000, credit: 0 },
      { accountId: acctCapital.id, debit: 0, credit: 500000 },
    ],
  });
  await balanceUpdateService.updateBalances(em, userId, openOriginDate, [
    { accountId: acctAr.id, debitDiff: 500000, creditDiff: 0 },
    { accountId: acctCapital.id, debitDiff: 0, creditDiff: 500000 },
  ]);

  const c4 = await em.save(
    CommitmentEntity,
    em.create(CommitmentEntity, {
      userId,
      contactId: contactJose.id,
      direction: 'INFLOW',
      originType: 'CAPITAL_ADJUSTMENT',
      description: 'Saldo previo acordado por consultoría',
      notes: 'Sin fecha fija; no impacta flujo hasta asignar vencimiento',
      totalAmount: 500000,
      categoryAccountId: null,
      cashAccountId: null,
      controlAccountId: acctAr.id,
      initialTransactionId: openTx.id,
    }),
  );
  await em.save(
    CommitmentInstallmentEntity,
    em.create(CommitmentInstallmentEntity, {
      commitmentId: c4.id,
      installmentNumber: 1,
      dueDate: null,
      amount: 500000,
    }),
  );
}
