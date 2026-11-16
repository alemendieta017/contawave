import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactEntity } from '../database/entities/contact.entity';
import { CommitmentEntity } from '../database/entities/commitment.entity';
import { CommitmentInstallmentEntity } from '../database/entities/commitment-installment.entity';
import { CommitmentSettlementEntity } from '../database/entities/commitment-settlement.entity';
import { AccountEntity } from '../database/entities/account.entity';
import { CurrencyEntity } from '../database/entities/currency.entity';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { JournalEntryEntity } from '../database/entities/journal-entry.entity';
import { AuthModule } from '../auth/auth.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ContactController } from '../controllers/contact.controller';
import { CommitmentController } from '../controllers/commitment.controller';
import { ContactsUseCase } from '../../application/commitments/contacts.use-case';
import { SystemAccountService } from '../../application/commitments/system-account.service';
import { CreateCommitmentUseCase } from '../../application/commitments/create-commitment.use-case';
import { GetCommitmentsUseCase } from '../../application/commitments/get-commitments.use-case';
import { UpdateCommitmentUseCase } from '../../application/commitments/update-commitment.use-case';
import { DeleteCommitmentUseCase } from '../../application/commitments/delete-commitment.use-case';
import { ManageCommitmentInstallmentsUseCase } from '../../application/commitments/manage-commitment-installments.use-case';
import { SettleCommitmentInstallmentUseCase } from '../../application/commitments/settle-commitment-installment.use-case';
import { ForgiveCommitmentInstallmentUseCase } from '../../application/commitments/forgive-commitment-installment.use-case';
import { RescheduleCommitmentInstallmentUseCase } from '../../application/commitments/reschedule-commitment-installment.use-case';
import { UndoCommitmentSettlementUseCase } from '../../application/commitments/undo-commitment-settlement.use-case';
import { CommitmentCashFlowAdapter } from '../../application/commitments/commitment-cash-flow.adapter';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ContactEntity,
      CommitmentEntity,
      CommitmentInstallmentEntity,
      CommitmentSettlementEntity,
      AccountEntity,
      CurrencyEntity,
      TransactionEntity,
      JournalEntryEntity,
    ]),
    AuthModule,
    LedgerModule,
  ],
  controllers: [ContactController, CommitmentController],
  providers: [
    ContactsUseCase,
    SystemAccountService,
    GetCommitmentsUseCase,
    CreateCommitmentUseCase,
    UpdateCommitmentUseCase,
    DeleteCommitmentUseCase,
    ManageCommitmentInstallmentsUseCase,
    SettleCommitmentInstallmentUseCase,
    ForgiveCommitmentInstallmentUseCase,
    RescheduleCommitmentInstallmentUseCase,
    UndoCommitmentSettlementUseCase,
    CommitmentCashFlowAdapter,
  ],
  exports: [
    ContactsUseCase,
    SystemAccountService,
    GetCommitmentsUseCase,
    CreateCommitmentUseCase,
    UpdateCommitmentUseCase,
    DeleteCommitmentUseCase,
    ManageCommitmentInstallmentsUseCase,
    SettleCommitmentInstallmentUseCase,
    ForgiveCommitmentInstallmentUseCase,
    RescheduleCommitmentInstallmentUseCase,
    UndoCommitmentSettlementUseCase,
    CommitmentCashFlowAdapter,
  ],
})
export class CommitmentsModule {}
