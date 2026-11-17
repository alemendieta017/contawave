import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ContactDto,
  CreateContactRequest,
  CreateContactRequestSchema,
  UpdateContactRequest,
  UpdateContactRequestSchema,
} from '@sistema-contable/shared';
import { ContactEntity } from '../../infrastructure/database/entities/contact.entity';
import { CommitmentEntity } from '../../infrastructure/database/entities/commitment.entity';
import {
  calculateInstallmentDerived,
  roundMoney,
} from '../../domain/commitments/commitment-calculator';

@Injectable()
export class ContactsUseCase {
  constructor(
    @InjectRepository(ContactEntity)
    private readonly contactRepository: Repository<ContactEntity>,
    @InjectRepository(CommitmentEntity)
    private readonly commitmentRepository: Repository<CommitmentEntity>,
  ) {}

  private async loadStatsByContact(
    userId: string,
    contactId?: string,
  ): Promise<Map<string, { receivable: number; payable: number; count: number }>> {
    const commitments = await this.commitmentRepository.find({
      where: contactId ? { userId, contactId } : { userId },
      relations: [
        'initialTransaction',
        'installments',
        'installments.settlements',
        'installments.settlements.transaction',
      ],
    });

    const statsByContact = new Map<
      string,
      { receivable: number; payable: number; count: number }
    >();

    for (const c of commitments) {
      if (c.initialTransaction?.status === 'REVERSED') {
        continue;
      }
      const current = statsByContact.get(c.contactId) || {
        receivable: 0,
        payable: 0,
        count: 0,
      };
      current.count += 1;

      const pending = (c.installments || []).reduce(
        (sum, inst) => sum + calculateInstallmentDerived(inst).pendingAmount,
        0,
      );
      if (c.direction === 'INFLOW') {
        current.receivable += pending;
      } else {
        current.payable += pending;
      }
      statsByContact.set(c.contactId, current);
    }

    return statsByContact;
  }

  private toContactDto(
    ct: ContactEntity,
    stats: { receivable: number; payable: number; count: number } = {
      receivable: 0,
      payable: 0,
      count: 0,
    },
  ): ContactDto {
    return {
      id: ct.id,
      name: ct.name,
      notes: ct.notes ?? null,
      createdAt: ct.createdAt.toISOString(),
      activeReceivable: roundMoney(stats.receivable),
      activePayable: roundMoney(stats.payable),
      commitmentCount: stats.count,
    };
  }

  async list(userId: string): Promise<ContactDto[]> {
    const [contacts, statsByContact] = await Promise.all([
      this.contactRepository.find({
        where: { userId },
        order: { name: 'ASC' },
      }),
      this.loadStatsByContact(userId),
    ]);

    return contacts.map((ct) => this.toContactDto(ct, statsByContact.get(ct.id)));
  }

  async create(userId: string, dto: CreateContactRequest): Promise<ContactDto> {
    const parsed = CreateContactRequestSchema.parse(dto);
    const trimmedName = parsed.name.trim();

    const duplicate = await this.contactRepository
      .createQueryBuilder('contact')
      .where('contact.userId = :userId', { userId })
      .andWhere('LOWER(contact.name) = LOWER(:name)', { name: trimmedName })
      .getOne();

    if (duplicate) {
      throw new ConflictException(`Ya existe un contacto llamado "${duplicate.name}"`);
    }

    const entity = this.contactRepository.create({
      userId,
      name: trimmedName,
      notes: parsed.notes ?? null,
    });
    const saved = await this.contactRepository.save(entity);

    return this.toContactDto(saved);
  }

  async update(userId: string, contactId: string, dto: UpdateContactRequest): Promise<ContactDto> {
    const parsed = UpdateContactRequestSchema.parse(dto);
    const contact = await this.contactRepository.findOne({
      where: { id: contactId, userId },
    });
    if (!contact) {
      throw new NotFoundException(`Contacto con ID ${contactId} no encontrado`);
    }

    if (parsed.name !== undefined) {
      const trimmedName = parsed.name.trim();
      const duplicate = await this.contactRepository
        .createQueryBuilder('contact')
        .where('contact.userId = :userId', { userId })
        .andWhere('LOWER(contact.name) = LOWER(:name)', { name: trimmedName })
        .andWhere('contact.id != :contactId', { contactId })
        .getOne();

      if (duplicate) {
        throw new ConflictException(`Ya existe otro contacto llamado "${duplicate.name}"`);
      }
      contact.name = trimmedName;
    }

    if (parsed.notes !== undefined) {
      contact.notes = parsed.notes ?? null;
    }

    const saved = await this.contactRepository.save(contact);
    const statsByContact = await this.loadStatsByContact(userId, saved.id);
    return this.toContactDto(saved, statsByContact.get(saved.id));
  }

  async delete(userId: string, contactId: string): Promise<{ success: boolean }> {
    const contact = await this.contactRepository.findOne({
      where: { id: contactId, userId },
    });
    if (!contact) {
      throw new NotFoundException(`Contacto con ID ${contactId} no encontrado`);
    }

    const linkedCount = await this.commitmentRepository.count({
      where: { userId, contactId },
    });
    if (linkedCount > 0) {
      throw new BadRequestException(
        'No se puede eliminar este contacto porque tiene compromisos registrados',
      );
    }

    await this.contactRepository.delete({ id: contactId, userId });
    return { success: true };
  }
}
