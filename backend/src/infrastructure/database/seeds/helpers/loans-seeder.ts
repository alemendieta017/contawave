import { EntityManager } from 'typeorm';
import { AccountEntity } from '../../entities/account.entity';
import { CurrencyEntity } from '../../entities/currency.entity';
import { PeriodEntity } from '../../entities/period.entity';
import { TransactionEntity } from '../../entities/transaction.entity';
import { LoanEntity } from '../../entities/loan.entity';
import { LoanChargeColumnEntity } from '../../entities/loan-charge-column.entity';
import { LoanInstallmentEntity } from '../../entities/loan-installment.entity';
import { LoanPaymentAllocationEntity } from '../../entities/loan-payment-allocation.entity';
import { BalanceUpdateService } from '../../../../application/periods/balance-update.service';
import { getTodayIsoDate } from '../../../../domain/commitments/commitment-calculator';
import { LedgerBuilder } from './ledger-builder';

function addMonthsSafe(isoDate: string, monthsToAdd: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1 + monthsToAdd, 1));
  const maxDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  const safeDay = Math.min(d, maxDay);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(
    safeDay,
  ).padStart(2, '0')}`;
}

export async function seedDefaultLoans(
  em: EntityManager,
  userId: string,
  baseCurrency: CurrencyEntity,
  accountMap: Map<string, AccountEntity>,
  builder: LedgerBuilder,
  balanceUpdateService: BalanceUpdateService,
): Promise<void> {
  const periods = await em.find(PeriodEntity, {
    where: { userId },
    order: { startDate: 'ASC' },
  });
  if (periods.length === 0) return;

  const acctBanco = accountMap.get('Banco Principal');
  const acctInterest = accountMap.get('Intereses y Cargos Financieros');
  const acctSeguro = accountMap.get('Seguros');
  if (!acctBanco || !acctInterest || !acctSeguro) return;

  const todayIso = getTodayIsoDate();
  let currentIdx = periods.findIndex(
    (p) => String(p.startDate) <= todayIso && todayIso <= String(p.endDate),
  );
  if (currentIdx === -1) {
    currentIdx = Math.min(Math.floor(periods.length / 2), periods.length - 1);
  }
  const prevIdx = Math.max(0, currentIdx - 1);
  const openingDate = `${String(periods[prevIdx].startDate).slice(0, 7)}-03`;

  const liabilityAccount = await em.save(
    AccountEntity,
    em.create(AccountEntity, {
      userId,
      name: 'Préstamo Auto Itaú',
      type: 'LIABILITY',
      currencyId: baseCurrency.id,
      status: 'ACTIVE',
      isCashOrBank: false,
      systemRole: null,
      isControlAccount: true,
      controlType: 'LOAN',
      parentId: null,
    }),
  );

  const initialPrincipal = 12000000;
  const initialTx = await builder.createTransaction({
    description: '[Préstamo] Desembolso · Préstamo Auto Itaú',
    accountingDate: openingDate,
    originModule: 'LOAN',
    entries: [
      { accountId: acctBanco.id, debit: initialPrincipal, credit: 0 },
      { accountId: liabilityAccount.id, debit: 0, credit: initialPrincipal },
    ],
  });
  await balanceUpdateService.updateBalances(em, userId, openingDate, [
    { accountId: acctBanco.id, debitDiff: initialPrincipal, creditDiff: 0 },
    { accountId: liabilityAccount.id, debitDiff: 0, creditDiff: initialPrincipal },
  ]);

  const loan = await em.save(
    LoanEntity,
    em.create(LoanEntity, {
      userId,
      name: 'Préstamo Auto Itaú',
      currencyId: baseCurrency.id,
      initialPrincipal,
      annualRate: 13.5,
      openingDate,
      startInstallmentNumber: 1,
      totalInstallmentsCount: 6,
      liabilityAccountId: liabilityAccount.id,
      defaultPaymentAccountId: acctBanco.id,
      initialTransactionId: initialTx.id,
      status: 'ACTIVE',
    }),
  );
  await em.update(TransactionEntity, { id: initialTx.id }, { originEntityId: loan.id });

  const colInterest = await em.save(
    LoanChargeColumnEntity,
    em.create(LoanChargeColumnEntity, {
      loanId: loan.id,
      name: 'Interés',
      expenseAccountId: acctInterest.id,
      isActive: true,
      sortOrder: 0,
    }),
  );

  const colInsurance = await em.save(
    LoanChargeColumnEntity,
    em.create(LoanChargeColumnEntity, {
      loanId: loan.id,
      name: 'Seguro de Vida',
      expenseAccountId: acctSeguro.id,
      isActive: true,
      sortOrder: 1,
    }),
  );

  const firstDueDate = `${String(periods[prevIdx].startDate).slice(0, 7)}-15`;
  const principals = [1945000, 1967000, 1989000, 2011000, 2033000, 2055000];
  const interests = [135000, 113000, 91000, 69000, 47000, 25000];
  const insurance = 45000;

  const savedInstallments: LoanInstallmentEntity[] = [];
  for (let i = 0; i < 6; i++) {
    const inst = await em.save(
      LoanInstallmentEntity,
      em.create(LoanInstallmentEntity, {
        loanId: loan.id,
        installmentNumber: i + 1,
        dueDate: addMonthsSafe(firstDueDate, i),
        principalAmount: principals[i],
        chargesJson: {
          [colInterest.id]: interests[i],
          [colInsurance.id]: insurance,
        },
      }),
    );
    savedInstallments.push(inst);
  }

  // Sembrar pago real de la cuota #1 en el mes pasado
  const inst1 = savedInstallments[0];
  const pay1Date = `${String(periods[prevIdx].startDate).slice(0, 7)}-15`;
  const pay1Total = principals[0] + interests[0] + insurance;
  const pay1Tx = await builder.createTransaction({
    description: '[Préstamo] Pago cuota #1 · Préstamo Auto Itaú',
    accountingDate: pay1Date,
    originModule: 'LOAN',
    originEntityId: loan.id,
    entries: [
      { accountId: liabilityAccount.id, debit: principals[0], credit: 0 },
      { accountId: acctInterest.id, debit: interests[0], credit: 0 },
      { accountId: acctSeguro.id, debit: insurance, credit: 0 },
      { accountId: acctBanco.id, debit: 0, credit: pay1Total },
    ],
  });
  await balanceUpdateService.updateBalances(em, userId, pay1Date, [
    { accountId: liabilityAccount.id, debitDiff: principals[0], creditDiff: 0 },
    { accountId: acctInterest.id, debitDiff: interests[0], creditDiff: 0 },
    { accountId: acctSeguro.id, debitDiff: insurance, creditDiff: 0 },
    { accountId: acctBanco.id, debitDiff: 0, creditDiff: pay1Total },
  ]);

  const principalJe = pay1Tx.entries.find((e) => e.accountId === liabilityAccount.id) || null;
  await em.save(
    LoanPaymentAllocationEntity,
    em.create(LoanPaymentAllocationEntity, {
      installmentId: inst1.id,
      transactionId: pay1Tx.id,
      principalJournalEntryId: principalJe ? principalJe.id : null,
      allocatedPrincipal: principals[0],
      allocatedChargesJson: {
        [colInterest.id]: interests[0],
        [colInsurance.id]: insurance,
      },
      paidAt: pay1Date,
    }),
  );
}
