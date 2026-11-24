import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  LoanDto,
  UpdateLoanPlanRequest,
  UpdateLoanPlanRequestSchema,
} from '@sistema-contable/shared';
import { AccountEntity } from '../../infrastructure/database/entities/account.entity';
import { LoanEntity } from '../../infrastructure/database/entities/loan.entity';
import { LoanChargeColumnEntity } from '../../infrastructure/database/entities/loan-charge-column.entity';
import { LoanInstallmentEntity } from '../../infrastructure/database/entities/loan-installment.entity';
import { calculateLoanInstallmentDerived, roundMoney } from '../../domain/loans/loan-calculator';
import { SystemAccountService } from '../commitments/system-account.service';
import { isControlAccount } from '../ledger/transaction-guards';
import { GetLoansUseCase } from './get-loans.use-case';

@Injectable()
export class UpdateLoanPlanUseCase {
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
    if (!account.isCashOrBank || isControlAccount(account)) {
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

  async execute(userId: string, loanId: string, dto: UpdateLoanPlanRequest): Promise<LoanDto> {
    const parsed = UpdateLoanPlanRequestSchema.parse(dto);

    await this.dataSource.transaction('SERIALIZABLE', async (em) => {
      const loan = await em.findOne(LoanEntity, {
        where: { id: loanId, userId },
        relations: [
          'currency',
          'liabilityAccount',
          'chargeColumns',
          'installments',
          'installments.allocations',
          'installments.allocations.transaction',
        ],
      });

      if (!loan) {
        throw new NotFoundException(`Préstamo con ID ${loanId} no encontrado`);
      }
      if (loan.status === 'CANCELLED') {
        throw new BadRequestException('No se puede editar un préstamo anulado');
      }

      if (parsed.defaultPaymentAccountId) {
        await this.validateLiquidAccount(
          em,
          userId,
          parsed.defaultPaymentAccountId,
          'Cuenta habitual de pago',
        );
      }

      const decimals = loan.currency?.decimalPlaces ?? 0;
      const rateToBase =
        Number(loan.currency?.rateToBase || 1) > 0 ? Number(loan.currency.rateToBase) : 1;

      const existingColumns = loan.chargeColumns || [];
      const existingInstallments = loan.installments || [];

      const paidInstallments: LoanInstallmentEntity[] = [];
      const editableExistingById = new Map<
        string,
        {
          entity: LoanInstallmentEntity;
          paidPrincipal: number;
          hasActiveAllocations: boolean;
        }
      >();

      let oldPendingPrincipal = 0;

      for (const inst of existingInstallments) {
        const derived = calculateLoanInstallmentDerived(inst, existingColumns);
        if (derived.status === 'PAID') {
          paidInstallments.push(inst);
        } else {
          oldPendingPrincipal += derived.pendingPrincipal;
          editableExistingById.set(inst.id, {
            entity: inst,
            paidPrincipal: derived.paidPrincipal,
            hasActiveAllocations: derived.activeAllocations.length > 0,
          });
        }
      }
      oldPendingPrincipal = roundMoney(oldPendingPrincipal, decimals);

      if (paidInstallments.length + parsed.installments.length < 1) {
        throw new BadRequestException('El préstamo debe conservar al menos 1 cuota en su plan');
      }

      // Determinar columnas con historial real POSTED
      const colHasAllocations = new Map<string, boolean>();
      for (const col of existingColumns) {
        const hasAlloc = existingInstallments.some((inst) =>
          (inst.allocations || []).some(
            (a) =>
              (!a.transaction || a.transaction.status === 'POSTED') &&
              Number((a.allocatedChargesJson || {})[col.id] || 0) > 0,
          ),
        );
        colHasAllocations.set(col.id, hasAlloc);
      }

      // 1. Reconciliar columnas de cargo
      const clientKeyToColId = new Map<string, string>();
      const activeColumnIds = new Set<string>();
      const inputColById = new Map(
        parsed.chargeColumns.filter((c) => Boolean(c.id)).map((c) => [c.id as string, c]),
      );

      for (const existingCol of existingColumns) {
        const hasAlloc = Boolean(colHasAllocations.get(existingCol.id));
        const inputMatch = inputColById.get(existingCol.id);

        if (inputMatch) {
          if (hasAlloc && inputMatch.expenseAccountId !== existingCol.expenseAccountId) {
            throw new BadRequestException(
              `La columna "${existingCol.name}" ya tiene pagos imputados y no puede cambiar su categoría de gasto.`,
            );
          }
          if (!hasAlloc && inputMatch.expenseAccountId !== existingCol.expenseAccountId) {
            await this.validateExpenseAccount(em, userId, inputMatch.expenseAccountId);
            existingCol.expenseAccountId = inputMatch.expenseAccountId;
          }
          existingCol.name = inputMatch.name.trim();
          existingCol.sortOrder = inputMatch.sortOrder ?? existingCol.sortOrder;
          existingCol.isActive = inputMatch.isActive !== false;
          await em.save(LoanChargeColumnEntity, existingCol);

          clientKeyToColId.set(existingCol.id, existingCol.id);
          clientKeyToColId.set(inputMatch.clientKey, existingCol.id);
          if (existingCol.isActive) {
            activeColumnIds.add(existingCol.id);
          }
        } else if (hasAlloc) {
          // Archivar hacia adelante sin destruir historial
          existingCol.isActive = false;
          await em.save(LoanChargeColumnEntity, existingCol);
          clientKeyToColId.set(existingCol.id, existingCol.id);
        } else {
          // Sin pagos históricos: eliminación física limpia
          await em.delete(LoanChargeColumnEntity, { id: existingCol.id });
        }
      }

      for (let idx = 0; idx < parsed.chargeColumns.length; idx++) {
        const colInput = parsed.chargeColumns[idx];
        if (colInput.id && existingColumns.some((c) => c.id === colInput.id)) {
          continue;
        }
        await this.validateExpenseAccount(em, userId, colInput.expenseAccountId);
        const createdCol = await em.save(
          LoanChargeColumnEntity,
          em.create(LoanChargeColumnEntity, {
            loanId: loan.id,
            name: colInput.name.trim(),
            expenseAccountId: colInput.expenseAccountId,
            isActive: colInput.isActive !== false,
            sortOrder: colInput.sortOrder ?? idx,
          }),
        );
        clientKeyToColId.set(colInput.clientKey, createdCol.id);
        if (createdCol.isActive) {
          activeColumnIds.add(createdCol.id);
        }
      }

      // 2. Validar protección de cuotas PAID y cuotas con pagos parciales
      const paidIds = new Set(paidInstallments.map((p) => p.id));
      const paidNumbers = new Set(paidInstallments.map((p) => p.installmentNumber));
      const incomingEditableIds = new Set(
        parsed.installments.filter((r) => Boolean(r.id)).map((r) => r.id as string),
      );

      for (const [id, info] of editableExistingById.entries()) {
        if (info.hasActiveAllocations && !incomingEditableIds.has(id)) {
          throw new BadRequestException(
            `La cuota #${info.entity.installmentNumber} tiene pagos registrados y no puede eliminarse.`,
          );
        }
      }

      let newPendingPrincipal = 0;
      const toSaveInstallments: LoanInstallmentEntity[] = [];

      for (const rowInput of parsed.installments) {
        if (rowInput.id && paidIds.has(rowInput.id)) {
          throw new BadRequestException('Las cuotas ya pagadas no pueden modificarse');
        }
        if (paidNumbers.has(rowInput.installmentNumber)) {
          throw new BadRequestException(
            `El número de cuota #${rowInput.installmentNumber} ya corresponde a una cuota pagada`,
          );
        }

        const existingInfo = rowInput.id ? editableExistingById.get(rowInput.id) : undefined;
        const paidPrincipalOnRow = existingInfo ? existingInfo.paidPrincipal : 0;
        const newPrincipal = roundMoney(Number(rowInput.principalAmount), decimals);

        if (newPrincipal + 0.0001 < paidPrincipalOnRow) {
          throw new BadRequestException(
            `El capital de la cuota #${rowInput.installmentNumber} no puede ser menor a lo ya pagado (${paidPrincipalOnRow}).`,
          );
        }

        const mappedCharges: Record<string, number> = {};
        for (const [key, val] of Object.entries(rowInput.charges || {})) {
          const colId = clientKeyToColId.get(key);
          if (colId && activeColumnIds.has(colId)) {
            mappedCharges[colId] = roundMoney(Number(val || 0), decimals);
          }
        }
        for (const col of existingColumns) {
          if (!activeColumnIds.has(col.id)) {
            mappedCharges[col.id] = 0;
          }
        }

        newPendingPrincipal += Math.max(0, roundMoney(newPrincipal - paidPrincipalOnRow, decimals));

        if (existingInfo) {
          existingInfo.entity.installmentNumber = rowInput.installmentNumber;
          existingInfo.entity.dueDate = rowInput.dueDate;
          existingInfo.entity.principalAmount = newPrincipal;
          existingInfo.entity.chargesJson = mappedCharges;
          toSaveInstallments.push(existingInfo.entity);
        } else {
          toSaveInstallments.push(
            em.create(LoanInstallmentEntity, {
              loanId: loan.id,
              installmentNumber: rowInput.installmentNumber,
              dueDate: rowInput.dueDate,
              principalAmount: newPrincipal,
              chargesJson: mappedCharges,
            }),
          );
        }
      }

      if (toSaveInstallments.length > 0) {
        await em.save(LoanInstallmentEntity, toSaveInstallments);
      }

      const idsToDelete: string[] = [];
      for (const [id, info] of editableExistingById.entries()) {
        if (!incomingEditableIds.has(id) && !info.hasActiveAllocations) {
          idsToDelete.push(id);
        }
      }
      if (idsToDelete.length > 0) {
        await em.delete(LoanInstallmentEntity, idsToDelete);
      }

      newPendingPrincipal = roundMoney(newPendingPrincipal, decimals);
      const deltaPrincipal = roundMoney(newPendingPrincipal - oldPendingPrincipal, decimals);

      // 3. Si cambió el capital pendiente total, exigir contrapartida y emitir asiento de ajuste
      if (Math.abs(deltaPrincipal) > 0.0001) {
        if (!parsed.capitalAdjustment) {
          throw new BadRequestException(
            'El capital pendiente cambió; debés seleccionar cómo reflejar el ajuste en tu Balance.',
          );
        }

        const adj = parsed.capitalAdjustment;
        const isIncrease = deltaPrincipal > 0;
        let counterpartAccountId: string;

        if (adj.type === 'CASH_TRANSFER') {
          const cashAcc = await this.validateLiquidAccount(
            em,
            userId,
            adj.cashAccountId!,
            'Cuenta bancaria / efectivo del ajuste',
          );
          counterpartAccountId = cashAcc.id;
        } else if (adj.type === 'CATEGORY') {
          const catAcc = await em.findOne(AccountEntity, {
            where: { id: adj.categoryAccountId!, userId },
          });
          if (!catAcc) {
            throw new NotFoundException('Categoría del ajuste no encontrada');
          }
          if (catAcc.status === 'INACTIVE') {
            throw new BadRequestException(`La categoría "${catAcc.name}" está inactiva`);
          }
          if (catAcc.isCashOrBank || isControlAccount(catAcc)) {
            throw new BadRequestException(
              `La cuenta "${catAcc.name}" debe ser una categoría operable`,
            );
          }
          const expectedType = isIncrease ? 'EXPENSE' : 'INCOME';
          if (catAcc.type !== expectedType) {
            throw new BadRequestException(
              `Para ${isIncrease ? 'incrementos' : 'rebajas'} de deuda debés elegir una categoría de ${
                expectedType === 'EXPENSE' ? 'Gasto' : 'Ingreso'
              }`,
            );
          }
          counterpartAccountId = catAcc.id;
        } else {
          const capitalAcc = await this.systemAccountService.getOrCreateSystemAccount(
            em,
            userId,
            'CAPITAL',
          );
          counterpartAccountId = capitalAcc.id;
        }

        const debitAccountId = isIncrease ? counterpartAccountId : loan.liabilityAccountId;
        const creditAccountId = isIncrease ? loan.liabilityAccountId : counterpartAccountId;
        const adjAmountBase = roundMoney(Math.abs(deltaPrincipal) * rateToBase, 4);

        await this.systemAccountService.postDoubleEntry(em, userId, {
          accountingDate: adj.adjustmentDate,
          description: `[Préstamo] Ajuste de capital (${
            isIncrease ? 'ampliación' : 'amortización/rebaja'
          }) · ${parsed.name.trim()}`,
          debitAccountId,
          creditAccountId,
          amountBase: adjAmountBase,
          originModule: 'LOAN',
          originEntityId: loan.id,
        });
      }

      // 4. Sincronizar metadatos del préstamo y nombre de cuenta de Pasivo
      const nextName = parsed.name.trim();
      if (nextName !== loan.name && loan.liabilityAccount) {
        const uniqueName = await this.systemAccountService.resolveUniqueAccountName(
          em,
          userId,
          nextName,
          loan.liabilityAccountId,
        );
        loan.liabilityAccount.name = uniqueName;
        await em.save(AccountEntity, loan.liabilityAccount);
      }

      loan.name = nextName;
      loan.annualRate = roundMoney(parsed.annualRate, 4);
      if (parsed.defaultPaymentAccountId !== undefined) {
        loan.defaultPaymentAccountId = parsed.defaultPaymentAccountId;
      }
      loan.totalInstallmentsCount = Math.max(
        1,
        loan.startInstallmentNumber - 1 + paidInstallments.length + parsed.installments.length,
      );
      loan.status = newPendingPrincipal <= 0.0001 ? 'SETTLED' : 'ACTIVE';

      await em.save(LoanEntity, loan);
    });

    return this.getLoansUseCase.getById(userId, loanId);
  }
}
