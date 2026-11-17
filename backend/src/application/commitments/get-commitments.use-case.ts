import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommitmentDto, CommitmentsListResponse } from '@sistema-contable/shared';
import { CommitmentEntity } from '../../infrastructure/database/entities/commitment.entity';
import { getTodayIsoDate } from '../../domain/commitments/commitment-calculator';
import { computeCommitmentsKpis, mapCommitmentToDto } from './commitment-mapper';

const COMMITMENT_RELATIONS = [
  'contact',
  'categoryAccount',
  'cashAccount',
  'controlAccount',
  'initialTransaction',
  'initialTransaction.entries',
  'initialTransaction.entries.account',
  'installments',
  'installments.settlements',
  'installments.settlements.transaction',
  'installments.settlements.journalEntry',
  'installments.settlements.journalEntry.account',
];

@Injectable()
export class GetCommitmentsUseCase {
  constructor(
    @InjectRepository(CommitmentEntity)
    private readonly commitmentRepository: Repository<CommitmentEntity>,
  ) {}

  async list(userId: string, timezoneOffset?: number): Promise<CommitmentsListResponse> {
    const today = getTodayIsoDate(timezoneOffset);
    const entities = await this.commitmentRepository.find({
      where: { userId },
      relations: COMMITMENT_RELATIONS,
      order: { createdAt: 'DESC' },
    });

    const activeEntities = entities.filter((e) => e.initialTransaction?.status !== 'REVERSED');
    const commitments = activeEntities.map((e) => mapCommitmentToDto(e, today));
    const kpis = computeCommitmentsKpis(commitments);

    return { kpis, commitments };
  }

  async getById(
    userId: string,
    commitmentId: string,
    timezoneOffset?: number,
  ): Promise<CommitmentDto> {
    const entity = await this.commitmentRepository.findOne({
      where: { id: commitmentId, userId },
      relations: COMMITMENT_RELATIONS,
    });

    if (!entity) {
      throw new NotFoundException(`Compromiso con ID ${commitmentId} no encontrado`);
    }

    return mapCommitmentToDto(entity, getTodayIsoDate(timezoneOffset));
  }
}
