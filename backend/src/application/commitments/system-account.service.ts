import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  SystemRole,
  DEFAULT_STARTER_ACCOUNTS,
  TransactionOriginModule,
} from '@sistema-contable/shared';
import { AccountEntity } from '../../infrastructure/database/entities/account.entity';
import { CurrencyEntity } from '../../infrastructure/database/entities/currency.entity';
import { TransactionEntity } from '../../infrastructure/database/entities/transaction.entity';
import { JournalEntryEntity } from '../../infrastructure/database/entities/journal-entry.entity';
import { EnsurePeriodService } from '../periods/ensure-period.service';
import { BalanceUpdateService } from '../periods/balance-update.service';

export interface DoubleEntryPostParams {
  accountingDate: string;
  description: string;
  debitAccountId: string;
  creditAccountId: string;
  amountBase: number;
  originModule?: TransactionOriginModule;
  originEntityId?: string | null;
}

export interface DoubleEntryPostResult {
  transaction: TransactionEntity;
  debitEntry: JournalEntryEntity;
  creditEntry: JournalEntryEntity;
}

@Injectable()
export class SystemAccountService {
  constructor(
    private readonly ensurePeriodService: EnsurePeriodService,
    private readonly balanceUpdateService: BalanceUpdateService,
  ) {}

  async getOrCreateSystemAccount(
    em: EntityManager,
    userId: string,
    role: SystemRole,
  ): Promise<AccountEntity> {
    const existingByRole = await em.findOne(AccountEntity, {
      where: { userId, systemRole: role },
      lock: { mode: 'pessimistic_write' },
    });
    const def = DEFAULT_STARTER_ACCOUNTS.find((a) => a.systemRole === role);
    if (existingByRole) {
      let dirty = false;
      if (existingByRole.status === 'INACTIVE') {
        existingByRole.status = 'ACTIVE';
        dirty = true;
      }
      if (def?.isControlAccount && !existingByRole.isControlAccount) {
        existingByRole.isControlAccount = true;
        existingByRole.controlType = def.controlType || null;
        dirty = true;
      }
      return dirty ? em.save(AccountEntity, existingByRole) : existingByRole;
    }

    if (!def) {
      throw new InternalServerErrorException(`System role definition not found for ${role}`);
    }

    const existingByName = await em.findOne(AccountEntity, {
      where: { userId, name: def.name },
      lock: { mode: 'pessimistic_write' },
    });
    if (existingByName) {
      existingByName.systemRole = role;
      existingByName.status = 'ACTIVE';
      existingByName.isControlAccount = !!def.isControlAccount;
      existingByName.controlType = def.controlType || null;
      return em.save(AccountEntity, existingByName);
    }

    const baseCurrency =
      (await em.findOne(CurrencyEntity, { where: { isBase: true } })) ||
      (await em.findOne(CurrencyEntity, { where: {} }));

    if (!baseCurrency) {
      throw new InternalServerErrorException(
        'Base currency is not configured. Cannot provision system account.',
      );
    }

    const created = em.create(AccountEntity, {
      userId,
      name: def.name,
      type: def.type,
      currencyId: baseCurrency.id,
      status: 'ACTIVE',
      isCashOrBank: !!def.isCashOrBank,
      systemRole: role,
      isControlAccount: !!def.isControlAccount,
      controlType: def.controlType || null,
      metadata: null,
      parentId: null,
    });
    return em.save(AccountEntity, created);
  }

  private async buildJournalEntryPayload(
    em: EntityManager,
    userId: string,
    accountId: string,
    entryType: 'DEBIT' | 'CREDIT',
    amountBase: number,
  ): Promise<{
    accountId: string;
    entryType: 'DEBIT' | 'CREDIT';
    amount: number;
    amountBase: number;
    rateAtDate: number;
  }> {
    const account = await em.findOne(AccountEntity, {
      where: { id: accountId, userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!account) {
      throw new NotFoundException(`Cuenta con ID ${accountId} no encontrada`);
    }
    if (account.status === 'INACTIVE') {
      throw new BadRequestException(`La cuenta ${account.name} está inactiva`);
    }

    const currency = await em.findOne(CurrencyEntity, { where: { id: account.currencyId } });
    const rateAtDate = Number(currency?.rateToBase ?? 1.0);
    const normalizedBase = Number(Number(amountBase).toFixed(4));
    const entryAmount =
      rateAtDate === 1 || rateAtDate <= 0
        ? normalizedBase
        : Number((normalizedBase / rateAtDate).toFixed(currency?.decimalPlaces ?? 4));

    return {
      accountId,
      entryType,
      amount: entryAmount,
      amountBase: normalizedBase,
      rateAtDate,
    };
  }

  async postDoubleEntry(
    em: EntityManager,
    userId: string,
    params: DoubleEntryPostParams,
  ): Promise<DoubleEntryPostResult> {
    if (params.amountBase <= 0) {
      throw new BadRequestException('El monto del asiento debe ser mayor a 0');
    }

    await this.ensurePeriodService.ensurePeriod(em, userId, params.accountingDate.substring(0, 7));

    const debitPayload = await this.buildJournalEntryPayload(
      em,
      userId,
      params.debitAccountId,
      'DEBIT',
      params.amountBase,
    );
    const creditPayload = await this.buildJournalEntryPayload(
      em,
      userId,
      params.creditAccountId,
      'CREDIT',
      params.amountBase,
    );

    if (Math.abs(debitPayload.amountBase - creditPayload.amountBase) > 0.0001) {
      throw new BadRequestException('El asiento contable no balancea entre Debe y Haber');
    }

    const tx = em.create(TransactionEntity, {
      userId,
      accountingDate: params.accountingDate,
      description: params.description,
      status: 'POSTED',
      originModule: params.originModule ?? 'MANUAL',
      originEntityId: params.originEntityId ?? null,
    });
    const savedTx = await em.save(TransactionEntity, tx);

    const debitEntry = await em.save(
      JournalEntryEntity,
      em.create(JournalEntryEntity, {
        transactionId: savedTx.id,
        ...debitPayload,
      }),
    );

    const creditEntry = await em.save(
      JournalEntryEntity,
      em.create(JournalEntryEntity, {
        transactionId: savedTx.id,
        ...creditPayload,
      }),
    );

    await this.balanceUpdateService.updateBalances(em, userId, params.accountingDate, [
      { accountId: debitEntry.accountId, debitDiff: debitPayload.amountBase, creditDiff: 0 },
      { accountId: creditEntry.accountId, debitDiff: 0, creditDiff: creditPayload.amountBase },
    ]);

    return { transaction: savedTx, debitEntry, creditEntry };
  }

  async rebuildTransactionEntries(
    em: EntityManager,
    userId: string,
    transactionId: string,
    newEntries: Array<{ accountId: string; entryType: 'DEBIT' | 'CREDIT'; amountBase: number }>,
    newDescription?: string,
  ): Promise<void> {
    const tx = await em.findOne(TransactionEntity, {
      where: { id: transactionId, userId },
      relations: ['entries'],
    });
    if (!tx) {
      throw new NotFoundException(`Transacción ${transactionId} no encontrada`);
    }
    if (tx.status === 'REVERSED') {
      throw new BadRequestException('No se puede ajustar una transacción revertida');
    }

    const oldChanges = tx.entries.map((e) => ({
      accountId: e.accountId,
      debitDiff: e.entryType === 'DEBIT' ? -Number(e.amountBase) : 0,
      creditDiff: e.entryType === 'CREDIT' ? -Number(e.amountBase) : 0,
    }));
    await this.balanceUpdateService.updateBalances(em, userId, tx.accountingDate, oldChanges);

    await em.delete(JournalEntryEntity, { transactionId: tx.id });

    const builtEntries: JournalEntryEntity[] = [];
    let totalDebit = 0;
    let totalCredit = 0;

    for (const item of newEntries) {
      const payload = await this.buildJournalEntryPayload(
        em,
        userId,
        item.accountId,
        item.entryType,
        item.amountBase,
      );
      if (item.entryType === 'DEBIT') totalDebit += payload.amountBase;
      else totalCredit += payload.amountBase;

      const created = em.create(JournalEntryEntity, {
        transactionId: tx.id,
        ...payload,
      });
      builtEntries.push(await em.save(JournalEntryEntity, created));
    }

    if (Math.abs(totalDebit - totalCredit) > 0.0001) {
      throw new BadRequestException('El ajuste del asiento contable no balancea');
    }

    if (newDescription !== undefined) {
      tx.description = newDescription;
      await em.save(TransactionEntity, tx);
    }

    const newChanges = builtEntries.map((e) => ({
      accountId: e.accountId,
      debitDiff: e.entryType === 'DEBIT' ? Number(e.amountBase) : 0,
      creditDiff: e.entryType === 'CREDIT' ? Number(e.amountBase) : 0,
    }));
    await this.balanceUpdateService.updateBalances(em, userId, tx.accountingDate, newChanges);
  }

  async deletePostedTransactionWithBalances(
    em: EntityManager,
    userId: string,
    transactionId: string,
  ): Promise<void> {
    const tx = await em.findOne(TransactionEntity, {
      where: { id: transactionId, userId },
      relations: ['entries'],
    });
    if (!tx) {
      return;
    }

    const balanceChanges = tx.entries.map((e) => ({
      accountId: e.accountId,
      debitDiff: e.entryType === 'DEBIT' ? -Number(e.amountBase) : 0,
      creditDiff: e.entryType === 'CREDIT' ? -Number(e.amountBase) : 0,
    }));
    await this.balanceUpdateService.updateBalances(em, userId, tx.accountingDate, balanceChanges);
    await em.remove(TransactionEntity, tx);
  }

  async syncCommitmentInitialTransactionAmount(
    em: EntityManager,
    userId: string,
    commitment: {
      direction: 'INFLOW' | 'OUTFLOW';
      originType: 'CATEGORY' | 'CASH_TRANSFER' | 'CAPITAL_ADJUSTMENT';
      controlAccountId: string;
      categoryAccountId: string | null;
      cashAccountId: string | null;
      initialTransactionId: string;
    },
    newTotalAmount: number,
  ): Promise<void> {
    let counterpartId: string;
    if (commitment.originType === 'CATEGORY' && commitment.categoryAccountId) {
      counterpartId = commitment.categoryAccountId;
    } else if (commitment.originType === 'CASH_TRANSFER' && commitment.cashAccountId) {
      counterpartId = commitment.cashAccountId;
    } else {
      const capitalAcc = await this.getOrCreateSystemAccount(em, userId, 'CAPITAL');
      counterpartId = capitalAcc.id;
    }

    const debitAccountId =
      commitment.direction === 'INFLOW' ? commitment.controlAccountId : counterpartId;
    const creditAccountId =
      commitment.direction === 'INFLOW' ? counterpartId : commitment.controlAccountId;

    await this.rebuildTransactionEntries(em, userId, commitment.initialTransactionId, [
      { accountId: debitAccountId, entryType: 'DEBIT', amountBase: newTotalAmount },
      { accountId: creditAccountId, entryType: 'CREDIT', amountBase: newTotalAmount },
    ]);
  }
}
