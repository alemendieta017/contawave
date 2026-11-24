import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TransactionOriginModule } from '@sistema-contable/shared';
import { AccountEntity } from '../../infrastructure/database/entities/account.entity';
import { TransactionEntity } from '../../infrastructure/database/entities/transaction.entity';
import { CommitmentEntity } from '../../infrastructure/database/entities/commitment.entity';
import { CommitmentSettlementEntity } from '../../infrastructure/database/entities/commitment-settlement.entity';
import { LoanEntity } from '../../infrastructure/database/entities/loan.entity';
import { LoanPaymentAllocationEntity } from '../../infrastructure/database/entities/loan-payment-allocation.entity';

export function getOriginModuleLabel(originModule?: TransactionOriginModule | null): string {
  switch (originModule) {
    case 'COMMITMENT':
      return 'Pagos y Cobros';
    case 'LOAN':
      return 'Préstamos';
    case 'CREDIT_CARD':
      return 'Tarjetas de Crédito';
    case 'BALANCE_ADJUSTMENT':
      return 'Ajuste de Saldo';
    default:
      return 'su módulo de origen';
  }
}

export function isControlAccount(
  account: Pick<AccountEntity, 'isControlAccount' | 'systemRole'>,
): boolean {
  return (
    Boolean(account.isControlAccount) ||
    account.systemRole === 'ACCOUNTS_RECEIVABLE' ||
    account.systemRole === 'ACCOUNTS_PAYABLE'
  );
}

export function assertAccountOperableForManualEntry(account: AccountEntity): void {
  if (account.status === 'INACTIVE') {
    throw new BadRequestException(`Account ${account.name} is inactive`);
  }

  if (account.systemRole === 'NET_INCOME') {
    throw new BadRequestException(
      'System account NET_INCOME is non-operable for manual journal entries',
    );
  }

  if (isControlAccount(account)) {
    throw new BadRequestException(
      `La cuenta "${account.name}" es una cuenta de control gestionada por su módulo especializado y no admite asientos manuales directos.`,
    );
  }
}

export async function assertTransactionMutationAllowed(
  em: EntityManager,
  tx: TransactionEntity,
  action: 'update' | 'delete' | 'reverse',
  options?: { allowControlled?: boolean },
): Promise<void> {
  if (action === 'update') {
    if (tx.status === 'REVERSED') {
      throw new BadRequestException('Cannot update a reversed transaction');
    }
    if (tx.reversalOfId !== null && tx.reversalOfId !== undefined) {
      throw new BadRequestException('Cannot update a reversal transaction');
    }
  } else if (action === 'delete') {
    if (tx.status === 'REVERSED') {
      throw new BadRequestException(
        'No se puede eliminar una transacción que ya fue anulada o revertida.',
      );
    }
    if (tx.reversalOfId !== null && tx.reversalOfId !== undefined) {
      throw new BadRequestException('No se puede eliminar un asiento de reversión.');
    }
  } else if (action === 'reverse') {
    if (tx.status === 'REVERSED') {
      throw new BadRequestException('Transaction is already reversed');
    }
    if (tx.reversalOfId !== null && tx.reversalOfId !== undefined) {
      throw new BadRequestException('No se puede reversar un asiento de reversión.');
    }
  }

  const checkOwnership = action !== 'reverse' || !options?.allowControlled;
  if (!checkOwnership) {
    return;
  }

  if (tx.originModule && tx.originModule !== 'MANUAL') {
    const label = getOriginModuleLabel(tx.originModule);
    throw new BadRequestException(
      `Esta transacción pertenece al módulo de ${label} y solo puede gestionarse desde allí.`,
    );
  }

  // Defensive check against subledger tables in case of legacy/untagged rows
  if (typeof em?.findOne === 'function') {
    const [linkedCommitment, linkedSettlement, linkedLoan, linkedLoanAllocation] =
      await Promise.all([
        em.findOne(CommitmentEntity, { where: { initialTransactionId: tx.id } }),
        em.findOne(CommitmentSettlementEntity, { where: { transactionId: tx.id } }),
        em.findOne(LoanEntity, { where: { initialTransactionId: tx.id } }),
        em.findOne(LoanPaymentAllocationEntity, { where: { transactionId: tx.id } }),
      ]);

    if (
      linkedCommitment?.initialTransactionId === tx.id ||
      linkedSettlement?.transactionId === tx.id
    ) {
      throw new BadRequestException(
        'Esta transacción pertenece al módulo de Pagos y Cobros y solo puede gestionarse desde allí.',
      );
    }

    if (
      linkedLoan?.initialTransactionId === tx.id ||
      linkedLoanAllocation?.transactionId === tx.id
    ) {
      throw new BadRequestException(
        'Esta transacción pertenece al módulo de Préstamos y solo puede gestionarse desde allí.',
      );
    }
  }
}
