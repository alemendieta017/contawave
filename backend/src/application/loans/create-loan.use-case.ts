import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CreateLoanRequest, CreateLoanRequestSchema, LoanDto } from '@sistema-contable/shared';
import { AccountEntity } from '../../infrastructure/database/entities/account.entity';
import { CurrencyEntity } from '../../infrastructure/database/entities/currency.entity';
import { LoanEntity } from '../../infrastructure/database/entities/loan.entity';
import { LoanChargeColumnEntity } from '../../infrastructure/database/entities/loan-charge-column.entity';
import { LoanInstallmentEntity } from '../../infrastructure/database/entities/loan-installment.entity';
import { TransactionEntity } from '../../infrastructure/database/entities/transaction.entity';
import { roundMoney } from '../../domain/loans/loan-calculator';
import { SystemAccountService } from '../commitments/system-account.service';
import { isControlAccount } from '../ledger/transaction-guards';
import { GetLoansUseCase } from './get-loans.use-case';

@Injectable()
export class CreateLoanUseCase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly systemAccountService: SystemAccountService,
    private readonly getLoansUseCase: GetLoansUseCase,
  ) {}

  private async validateLiquidAccount(
    em: EntityManager,
    userId: string,
    accountId: string,
    label: string,
  ): Promise<AccountEntity> {
    const account = await em.findOne(AccountEntity, { where: { id: accountId, userId } });
    if (!account) {
      throw new NotFoundException(`${label} no encontrada`);
    }
    if (account.status === 'INACTIVE') {
      throw new BadRequestException(`La cuenta "${account.name}" está inactiva`);
    }
    if (isControlAccount(account) || !account.isCashOrBank) {
      throw new BadRequestException(
        `La cuenta "${account.name}" debe ser una cuenta líquida (efectivo o banco)`,
      );
    }
    return account;
  }

  private async validateExpenseAccount(
    em: EntityManager,
    userId: string,
    accountId: string,
  ): Promise<AccountEntity> {
    const account = await em.findOne(AccountEntity, { where: { id: accountId, userId } });
    if (!account) {
      throw new NotFoundException(`Categoría de gasto con ID ${accountId} no encontrada`);
    }
    if (account.status === 'INACTIVE') {
      throw new BadRequestException(`La categoría "${account.name}" está inactiva`);
    }
    if (account.type !== 'EXPENSE' || account.isCashOrBank || isControlAccount(account)) {
      throw new BadRequestException(
        `La cuenta "${account.name}" debe ser una categoría de Gasto operable`,
      );
    }
    return account;
  }

  async execute(userId: string, dto: CreateLoanRequest): Promise<LoanDto> {
    const parsed = CreateLoanRequestSchema.parse(dto);

    const createdLoanId = await this.dataSource.transaction('SERIALIZABLE', async (em) => {
      const currency = parsed.currencyId
        ? await em.findOne(CurrencyEntity, { where: { id: parsed.currencyId } })
        : (await em.findOne(CurrencyEntity, { where: { isBase: true } })) ||
          (await em.findOne(CurrencyEntity, { where: {} }));

      if (!currency) {
        throw new NotFoundException('Moneda del préstamo no encontrada');
      }

      const rateToBase = Number(currency.rateToBase || 1) > 0 ? Number(currency.rateToBase) : 1;
      const decimals = currency.decimalPlaces ?? 0;

      // Validar cuentas líquidas
      let disbursementAccount: AccountEntity | null = null;
      if (parsed.openingMode === 'NEW') {
        disbursementAccount = await this.validateLiquidAccount(
          em,
          userId,
          parsed.disbursementAccountId!,
          'Cuenta de acreditación',
        );
      }

      const defaultPaymentId =
        parsed.defaultPaymentAccountId ||
        (parsed.openingMode === 'NEW' ? parsed.disbursementAccountId || null : null);

      if (defaultPaymentId) {
        await this.validateLiquidAccount(em, userId, defaultPaymentId, 'Cuenta de pago habitual');
      }

      // Validar categorías de gasto de todas las columnas configuradas
      for (const col of parsed.chargeColumns) {
        await this.validateExpenseAccount(em, userId, col.expenseAccountId);
      }

      const initialPrincipal = roundMoney(
        parsed.installments.reduce((sum, row) => sum + Number(row.principalAmount), 0),
        decimals,
      );
      if (initialPrincipal <= 0) {
        throw new BadRequestException('El capital total del préstamo debe ser mayor a 0');
      }

      // Auto-crear cuenta de Pasivo dedicada con control de colisión de nombres
      const uniqueLiabilityName = await this.systemAccountService.resolveUniqueAccountName(
        em,
        userId,
        parsed.name,
      );

      const liabilityAccount = await em.save(
        AccountEntity,
        em.create(AccountEntity, {
          userId,
          name: uniqueLiabilityName,
          type: 'LIABILITY',
          currencyId: currency.id,
          status: 'ACTIVE',
          isCashOrBank: false,
          systemRole: null,
          isControlAccount: true,
          controlType: 'LOAN',
          metadata: null,
          parentId: null,
        }),
      );

      // Determinar contrapartida contable del asiento de apertura
      let counterpartAccountId: string;
      let txDescription: string;
      if (parsed.openingMode === 'NEW' && disbursementAccount) {
        counterpartAccountId = disbursementAccount.id;
        txDescription = `[Préstamo] Desembolso · ${uniqueLiabilityName}`;
      } else {
        const capitalAccount = await this.systemAccountService.getOrCreateSystemAccount(
          em,
          userId,
          'CAPITAL',
        );
        counterpartAccountId = capitalAccount.id;
        txDescription = `[Préstamo] Apertura de deuda · ${uniqueLiabilityName}`;
      }

      const amountBase = roundMoney(initialPrincipal * rateToBase, 4);
      const { transaction } = await this.systemAccountService.postDoubleEntry(em, userId, {
        accountingDate: parsed.openingDate,
        description: txDescription,
        debitAccountId: counterpartAccountId,
        creditAccountId: liabilityAccount.id,
        amountBase,
        originModule: 'LOAN',
      });

      const minInstNum = Math.min(...parsed.installments.map((i) => i.installmentNumber));
      const maxInstNum = Math.max(...parsed.installments.map((i) => i.installmentNumber));
      const startInstallmentNumber = parsed.startInstallmentNumber ?? minInstNum;
      const totalInstallmentsCount = Math.max(
        parsed.totalInstallmentsCount ?? maxInstNum,
        maxInstNum,
      );

      const loan = await em.save(
        LoanEntity,
        em.create(LoanEntity, {
          userId,
          name: parsed.name.trim(),
          currencyId: currency.id,
          initialPrincipal,
          annualRate: roundMoney(parsed.annualRate ?? 0, 4),
          openingDate: parsed.openingDate,
          startInstallmentNumber,
          totalInstallmentsCount,
          liabilityAccountId: liabilityAccount.id,
          defaultPaymentAccountId: defaultPaymentId,
          initialTransactionId: transaction.id,
          status: 'ACTIVE',
        }),
      );

      if (typeof em.update === 'function') {
        await em.update(TransactionEntity, { id: transaction.id }, { originEntityId: loan.id });
      }

      const clientKeyToColId = new Map<string, string>();
      const sortedColumns = [...parsed.chargeColumns].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
      );
      for (let idx = 0; idx < sortedColumns.length; idx++) {
        const colInput = sortedColumns[idx];
        const savedCol = await em.save(
          LoanChargeColumnEntity,
          em.create(LoanChargeColumnEntity, {
            loanId: loan.id,
            name: colInput.name.trim(),
            expenseAccountId: colInput.expenseAccountId,
            isActive: colInput.isActive !== false,
            sortOrder: colInput.sortOrder ?? idx,
          }),
        );
        clientKeyToColId.set(colInput.clientKey, savedCol.id);
      }

      const sortedRows = [...parsed.installments].sort(
        (a, b) => a.installmentNumber - b.installmentNumber,
      );
      const installmentEntities = sortedRows.map((row) => {
        const mappedCharges: Record<string, number> = {};
        for (const [key, val] of Object.entries(row.charges || {})) {
          const resolvedColId = clientKeyToColId.get(key);
          if (resolvedColId) {
            mappedCharges[resolvedColId] = roundMoney(Number(val || 0), decimals);
          }
        }
        return em.create(LoanInstallmentEntity, {
          loanId: loan.id,
          installmentNumber: row.installmentNumber,
          dueDate: row.dueDate,
          principalAmount: roundMoney(Number(row.principalAmount), decimals),
          chargesJson: mappedCharges,
        });
      });

      await em.save(LoanInstallmentEntity, installmentEntities);

      return loan.id;
    });

    return this.getLoansUseCase.getById(userId, createdLoanId);
  }
}
