import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { DangerZoneAction, DangerZoneResponse } from '@sistema-contable/shared';
import { InvalidCurrentPasswordException } from '../../domain/exceptions/auth.exception';
import { UserEntity } from '../../infrastructure/database/entities/user.entity';
import { AccountEntity } from '../../infrastructure/database/entities/account.entity';
import { TransactionEntity } from '../../infrastructure/database/entities/transaction.entity';
import { JournalEntryEntity } from '../../infrastructure/database/entities/journal-entry.entity';
import { PeriodEntity } from '../../infrastructure/database/entities/period.entity';
import { AccountPeriodBalanceEntity } from '../../infrastructure/database/entities/account-period-balance.entity';
import { BudgetEntity } from '../../infrastructure/database/entities/budget.entity';
import { BudgetItemEntity } from '../../infrastructure/database/entities/budget-item.entity';
import { BudgetReassignmentEntity } from '../../infrastructure/database/entities/budget-reassignment.entity';
import { PasswordResetTokenEntity } from '../../infrastructure/database/entities/password-reset-token.entity';
import { ContactEntity } from '../../infrastructure/database/entities/contact.entity';
import { CommitmentEntity } from '../../infrastructure/database/entities/commitment.entity';
import { CommitmentInstallmentEntity } from '../../infrastructure/database/entities/commitment-installment.entity';
import { CommitmentSettlementEntity } from '../../infrastructure/database/entities/commitment-settlement.entity';
import { LoanEntity } from '../../infrastructure/database/entities/loan.entity';
import { LoanChargeColumnEntity } from '../../infrastructure/database/entities/loan-charge-column.entity';
import { LoanInstallmentEntity } from '../../infrastructure/database/entities/loan-installment.entity';
import { LoanPaymentAllocationEntity } from '../../infrastructure/database/entities/loan-payment-allocation.entity';
import { DeleteAccountDto } from '../../infrastructure/controllers/dto/danger-zone.dto';

@Injectable()
export class DeleteUserAccountUseCase {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async execute(userOrId: UserEntity | string, dto: DeleteAccountDto): Promise<DangerZoneResponse> {
    const userId = typeof userOrId === 'string' ? userOrId : userOrId.id;
    let passwordHash =
      typeof userOrId === 'object' && userOrId.passwordHash ? userOrId.passwordHash : null;

    if (!passwordHash) {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }
      passwordHash = user.passwordHash;
    }

    const isMatch = await bcrypt.compare(dto.currentPassword, passwordHash);
    if (!isMatch) {
      throw new InvalidCurrentPasswordException();
    }

    await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      // 1. Delete user's budget reassignments
      await manager.delete(BudgetReassignmentEntity, { userId });

      // 2. Cascade delete user's budgets and budget items
      const userBudgets = await manager.find(BudgetEntity, { where: { userId } });
      const budgetIds = userBudgets.map((b) => b.id);
      if (budgetIds.length > 0) {
        await manager
          .createQueryBuilder()
          .delete()
          .from(BudgetItemEntity)
          .where('budget_id IN (:...budgetIds)', { budgetIds })
          .execute();
        await manager.delete(BudgetEntity, { userId });
      }

      // 3. Delete user's account period balances
      const userAccounts = await manager.find(AccountEntity, { where: { userId } });
      const accountIds = userAccounts.map((a) => a.id);
      if (accountIds.length > 0) {
        await manager
          .createQueryBuilder()
          .delete()
          .from(AccountPeriodBalanceEntity)
          .where('account_id IN (:...accountIds)', { accountIds })
          .execute();
      }

      // 3b. Delete user's commitment settlements, installments, commitments and contacts
      const userCommitments = await manager.find(CommitmentEntity, { where: { userId } });
      const commitmentIds = userCommitments.map((c) => c.id);
      if (commitmentIds.length > 0) {
        const installments = await manager
          .createQueryBuilder(CommitmentInstallmentEntity, 'inst')
          .where('inst.commitment_id IN (:...commitmentIds)', { commitmentIds })
          .getMany();
        const installmentIds = installments.map((i) => i.id);
        if (installmentIds.length > 0) {
          await manager
            .createQueryBuilder()
            .delete()
            .from(CommitmentSettlementEntity)
            .where('installment_id IN (:...installmentIds)', { installmentIds })
            .execute();
        }
        await manager
          .createQueryBuilder()
          .delete()
          .from(CommitmentInstallmentEntity)
          .where('commitment_id IN (:...commitmentIds)', { commitmentIds })
          .execute();
        await manager.delete(CommitmentEntity, { userId });
      }
      await manager.delete(ContactEntity, { userId });

      // 3c. Delete user's loan allocations, installments, charge columns and loans
      const userLoans = (await manager.find(LoanEntity, { where: { userId } })) || [];
      const loanIds = userLoans.map((l) => l.id);
      if (loanIds.length > 0) {
        const loanInstallments = await manager
          .createQueryBuilder(LoanInstallmentEntity, 'li')
          .where('li.loan_id IN (:...loanIds)', { loanIds })
          .getMany();
        const loanInstallmentIds = loanInstallments.map((i) => i.id);
        if (loanInstallmentIds.length > 0) {
          await manager
            .createQueryBuilder()
            .delete()
            .from(LoanPaymentAllocationEntity)
            .where('installment_id IN (:...loanInstallmentIds)', { loanInstallmentIds })
            .execute();
        }
        await manager
          .createQueryBuilder()
          .delete()
          .from(LoanInstallmentEntity)
          .where('loan_id IN (:...loanIds)', { loanIds })
          .execute();
        await manager
          .createQueryBuilder()
          .delete()
          .from(LoanChargeColumnEntity)
          .where('loan_id IN (:...loanIds)', { loanIds })
          .execute();
        await manager.delete(LoanEntity, { userId });
      }

      // 4. Delete user's journal entries and transactions
      const userTransactions = await manager.find(TransactionEntity, { where: { userId } });
      const txIds = userTransactions.map((t) => t.id);
      if (txIds.length > 0) {
        await manager
          .createQueryBuilder()
          .delete()
          .from(JournalEntryEntity)
          .where('transaction_id IN (:...txIds)', { txIds })
          .execute();
        await manager
          .createQueryBuilder()
          .update(TransactionEntity)
          .set({ reversalOfId: null as any })
          .where('user_id = :userId', { userId })
          .execute();
        await manager.delete(TransactionEntity, { userId });
      }

      // 5. Delete user's periods
      await manager.delete(PeriodEntity, { userId });

      // 6. Delete user's accounts (clear parent_id first to prevent FK cycles)
      if (accountIds.length > 0) {
        await manager
          .createQueryBuilder()
          .update(AccountEntity)
          .set({ parentId: null as any })
          .where('user_id = :userId', { userId })
          .execute();
        await manager.delete(AccountEntity, { userId });
      }

      // 7. Delete password reset tokens
      await manager.delete(PasswordResetTokenEntity, { userId });

      // 8. Delete user entity
      await manager.delete(UserEntity, { id: userId });
    });

    return {
      success: true,
      message: 'La cuenta y todos los datos asociados han sido eliminados permanentemente.',
      action: DangerZoneAction.DELETE_ACCOUNT,
      timestamp: new Date().toISOString(),
    };
  }
}
