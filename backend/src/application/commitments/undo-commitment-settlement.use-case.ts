import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommitmentDto } from '@sistema-contable/shared';
import { CommitmentSettlementEntity } from '../../infrastructure/database/entities/commitment-settlement.entity';
import { ReverseTransactionUseCase } from '../ledger/reverse-transaction.use-case';
import { GetCommitmentsUseCase } from './get-commitments.use-case';

@Injectable()
export class UndoCommitmentSettlementUseCase {
  constructor(
    @InjectRepository(CommitmentSettlementEntity)
    private readonly settlementRepository: Repository<CommitmentSettlementEntity>,
    private readonly reverseTransactionUseCase: ReverseTransactionUseCase,
    private readonly getCommitmentsUseCase: GetCommitmentsUseCase,
  ) {}

  async execute(userId: string, settlementId: string): Promise<CommitmentDto> {
    const settlement = await this.settlementRepository.findOne({
      where: { id: settlementId },
      relations: ['installment', 'installment.commitment'],
    });

    if (!settlement || settlement.installment?.commitment?.userId !== userId) {
      throw new NotFoundException(`Liquidación con ID ${settlementId} no encontrada`);
    }

    await this.reverseTransactionUseCase.execute(userId, settlement.transactionId, {
      allowControlled: true,
    });

    return this.getCommitmentsUseCase.getById(userId, settlement.installment.commitmentId);
  }
}
