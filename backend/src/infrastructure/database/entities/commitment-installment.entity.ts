import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
  Check,
} from 'typeorm';
import { CommitmentEntity } from './commitment.entity';
import { CommitmentSettlementEntity } from './commitment-settlement.entity';

@Entity('commitment_installments')
@Index(['commitmentId'])
@Index(['dueDate'])
@Check(`"amount" > 0`)
export class CommitmentInstallmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'commitment_id', type: 'uuid' })
  commitmentId: string;

  @ManyToOne(() => CommitmentEntity, (commitment) => commitment.installments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'commitment_id' })
  commitment: CommitmentEntity;

  @Column({ name: 'installment_number', type: 'int' })
  installmentNumber: number;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  @OneToMany(() => CommitmentSettlementEntity, (settlement) => settlement.installment)
  settlements: CommitmentSettlementEntity[];
}
