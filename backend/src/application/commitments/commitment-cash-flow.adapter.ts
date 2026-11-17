import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CashFlowCommitmentSource, ScheduledCashFlowItem } from '@sistema-contable/shared';
import { CommitmentInstallmentEntity } from '../../infrastructure/database/entities/commitment-installment.entity';
import { calculateInstallmentDerived } from '../../domain/commitments/commitment-calculator';

@Injectable()
export class CommitmentCashFlowAdapter implements CashFlowCommitmentSource {
  constructor(
    @InjectRepository(CommitmentInstallmentEntity)
    private readonly installmentRepository: Repository<CommitmentInstallmentEntity>,
  ) {}

  async getScheduledCashFlowItems(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<ScheduledCashFlowItem[]> {
    const installments = await this.installmentRepository
      .createQueryBuilder('inst')
      .innerJoinAndSelect('inst.commitment', 'commitment')
      .leftJoinAndSelect('commitment.initialTransaction', 'initialTx')
      .leftJoinAndSelect('commitment.contact', 'contact')
      .leftJoinAndSelect('inst.settlements', 'settlements')
      .leftJoinAndSelect('settlements.transaction', 'settlementTx')
      .where('commitment.userId = :userId', { userId })
      .andWhere('inst.dueDate IS NOT NULL')
      .andWhere('inst.dueDate >= :startDate', { startDate })
      .andWhere('inst.dueDate <= :endDate', { endDate })
      .orderBy('inst.dueDate', 'ASC')
      .getMany();

    const items: ScheduledCashFlowItem[] = [];

    for (const inst of installments) {
      if (inst.commitment?.initialTransaction?.status === 'REVERSED') {
        continue;
      }
      const derived = calculateInstallmentDerived(inst);
      if (derived.pendingAmount <= 0 || !inst.dueDate) {
        continue;
      }

      const dueDateStr = String(inst.dueDate);
      const contactName = inst.commitment.contact?.name || 'Contacto';

      items.push({
        dueDate: dueDateStr,
        periodName: dueDateStr.substring(0, 7),
        amount: derived.pendingAmount,
        direction: inst.commitment.direction,
        categoryAccountId: inst.commitment.categoryAccountId || inst.commitment.controlAccountId,
        controlAccountId: inst.commitment.controlAccountId,
        sourceType: 'COMMITMENT',
        sourceId: inst.id,
        commitmentId: inst.commitment.id,
        contactId: inst.commitment.contactId,
        contactName,
        label: `${contactName} — ${inst.commitment.description} (Cuota ${inst.installmentNumber})`,
      });
    }

    return items;
  }
}
