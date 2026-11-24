import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoanDto, LoansListResponse } from '@sistema-contable/shared';
import { LoanEntity } from '../../infrastructure/database/entities/loan.entity';
import { TransactionEntity } from '../../infrastructure/database/entities/transaction.entity';
import { computeLoansKpis, getTodayIsoDate } from '../../domain/loans/loan-calculator';
import { mapLoanToDto } from './loan-mapper';

const LOAN_RELATIONS = [
  'currency',
  'liabilityAccount',
  'defaultPaymentAccount',
  'initialTransaction',
  'initialTransaction.entries',
  'initialTransaction.entries.account',
  'chargeColumns',
  'chargeColumns.expenseAccount',
  'installments',
  'installments.allocations',
  'installments.allocations.transaction',
  'installments.allocations.transaction.entries',
  'installments.allocations.transaction.entries.account',
];

@Injectable()
export class GetLoansUseCase {
  constructor(
    @InjectRepository(LoanEntity)
    private readonly loanRepository: Repository<LoanEntity>,
    @InjectRepository(TransactionEntity)
    private readonly transactionRepository: Repository<TransactionEntity>,
  ) {}

  private buildLoanTransactionMeta(
    loan: LoanEntity,
    loanTransactions: TransactionEntity[],
  ): { activeAdjustmentsCount: number; hasExtraHistory: boolean } {
    const allocationTxIds = new Set<string>();
    for (const inst of loan.installments || []) {
      for (const alloc of inst.allocations || []) {
        allocationTxIds.add(alloc.transactionId);
      }
    }

    const nonInitialTxs = loanTransactions.filter(
      (tx) =>
        tx.originEntityId === loan.id &&
        tx.id !== loan.initialTransactionId &&
        !allocationTxIds.has(tx.id),
    );

    const activeAdjustmentsCount = nonInitialTxs.filter(
      (tx) => tx.status === 'POSTED' && !tx.reversalOfId,
    ).length;

    return {
      activeAdjustmentsCount,
      hasExtraHistory: nonInitialTxs.length > 0,
    };
  }

  async list(userId: string, timezoneOffset?: number): Promise<LoansListResponse> {
    const todayIso = getTodayIsoDate(timezoneOffset);
    const entities = await this.loanRepository.find({
      where: { userId },
      relations: LOAN_RELATIONS,
      order: { createdAt: 'DESC' },
    });

    const activeEntities = entities.filter(
      (loan) => loan.status !== 'CANCELLED' && loan.initialTransaction?.status !== 'REVERSED',
    );

    const loanTransactions =
      activeEntities.length > 0
        ? (await this.transactionRepository.find({
            where: { userId, originModule: 'LOAN' },
          })) || []
        : [];

    const loans = activeEntities.map((entity) =>
      mapLoanToDto(entity, todayIso, this.buildLoanTransactionMeta(entity, loanTransactions)),
    );
    const kpis = computeLoansKpis(loans);

    return { kpis, loans };
  }

  async getById(userId: string, loanId: string, timezoneOffset?: number): Promise<LoanDto> {
    const entity = await this.loanRepository.findOne({
      where: { id: loanId, userId },
      relations: LOAN_RELATIONS,
    });

    if (!entity) {
      throw new NotFoundException(`Préstamo con ID ${loanId} no encontrado`);
    }

    const loanTransactions =
      (await this.transactionRepository.find({
        where: { userId, originModule: 'LOAN', originEntityId: loanId },
      })) || [];

    return mapLoanToDto(
      entity,
      getTodayIsoDate(timezoneOffset),
      this.buildLoanTransactionMeta(entity, loanTransactions),
    );
  }
}
