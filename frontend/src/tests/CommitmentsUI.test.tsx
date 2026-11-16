import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountType, CommitmentDto, ContactDto } from '@sistema-contable/shared';
import SettleInstallmentModal from '../components/commitments/SettleInstallmentModal';
import CommitmentsPage from '../app/commitments/page';
import NewCommitmentPage from '../app/commitments/new/page';
import CommitmentDetailPage from '../app/commitments/[id]/page';
import { api } from '../services/api';

const mockPush = jest.fn();
let mockRouteParams: { id?: string } = { id: 'comm-1' };

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => mockRouteParams,
}));

jest.mock('next/link', () => {
  return function MockLink({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  };
});

jest.mock('../services/api', () => ({
  api: {
    commitments: {
      list: jest.fn(),
      get: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      settleInstallment: jest.fn(),
      addInstallment: jest.fn(),
      deleteInstallment: jest.fn(),
      undoSettlement: jest.fn(),
      remove: jest.fn(),
    },
    contacts: {
      list: jest.fn(),
      create: jest.fn(),
    },
    accounts: {
      list: jest.fn(),
      summary: jest.fn(),
      create: jest.fn(),
    },
    currencies: {
      list: jest.fn(),
    },
  },
}));

const baseCurrency = { id: 'cur-pyg', code: 'PYG', symbol: '₲', decimalPlaces: 0, isBase: true };

const sampleContacts: ContactDto[] = [
  {
    id: 'contact-1',
    name: 'Don José',
    notes: null,
    createdAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'contact-2',
    name: 'Jessica Ciancio',
    notes: null,
    createdAt: '2026-11-01T00:00:00Z',
  },
];

const sampleAccounts = [
  {
    id: 'acc-cash',
    name: 'Caja Central',
    type: AccountType.ASSET,
    isCashOrBank: true,
    status: 'ACTIVE' as const,
    balance: 2000000,
    currencyCode: 'PYG',
    currencySymbol: '₲',
  },
  {
    id: 'acc-inc',
    name: 'Desarrollo web',
    type: AccountType.INCOME,
    isCashOrBank: false,
    status: 'ACTIVE' as const,
    balance: 0,
    currencyCode: 'PYG',
    currencySymbol: '₲',
  },
  {
    id: 'acc-exp',
    name: 'Servidores',
    type: AccountType.EXPENSE,
    isCashOrBank: false,
    status: 'ACTIVE' as const,
    balance: 0,
    currencyCode: 'PYG',
    currencySymbol: '₲',
  },
];

function makeCommitment(index: number, direction: 'INFLOW' | 'OUTFLOW' = 'INFLOW'): CommitmentDto {
  return {
    id: `comm-${index}`,
    contactId: 'contact-1',
    contactName: index === 1 ? 'Jessica Ciancio' : `Contacto ${index}`,
    direction,
    originType: 'CATEGORY',
    description: index === 1 ? 'Prestamo personal' : `Servicio proyecto ${index}`,
    notes: 'Nota inicial',
    totalAmount: 1000000,
    settledAmount: 0,
    pendingAmount: 1000000,
    status: 'PENDING',
    controlAccountId: 'acc-ar',
    controlAccountName: 'Cuentas por Cobrar',
    cashAccountId: null,
    cashAccountName: null,
    categoryAccountId: 'acc-inc',
    categoryAccountName: 'Desarrollo web',
    originBadgeText: 'Por Ventas / Servicios',
    initialTransactionId: `tx-${index}`,
    initialTransaction: null,
    nextDueDate: '2026-11-20',
    hasNoDateInstallments: false,
    createdAt: '2026-11-15T12:00:00Z',
    installments: [
      {
        id: `inst-${index}-1`,
        commitmentId: `comm-${index}`,
        installmentNumber: 1,
        amount: 500000,
        settledAmount: 0,
        pendingAmount: 500000,
        dueDate: '2026-11-20',
        status: 'PENDING',
        settlements: [],
      },
    ],
  };
}

describe('Commitments UI & Bug Fixes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { id: 'comm-1' };
  });

  test('SettleInstallmentModal uses new transaction label and formats amount with thousand separators', () => {
    const commitment = makeCommitment(1, 'INFLOW');
    render(
      <SettleInstallmentModal
        isOpen={true}
        onClose={jest.fn()}
        commitment={commitment}
        installment={commitment.installments[0]}
        cashAccounts={sampleAccounts}
        baseCurrency={baseCurrency}
        onSuccess={jest.fn()}
      />,
    );

    expect(screen.getByText('Transacción automática a registrar')).toBeInTheDocument();
    expect(screen.queryByText(/Asiento contable automático/i)).not.toBeInTheDocument();

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('500.000');

    fireEvent.change(input, { target: { value: '1250000' } });
    expect(input.value).toBe('1.250.000');
  });

  test('CommitmentsPage renders brand gradient hero KPI, updated subtitle, contact icon, and pagination', async () => {
    const manyCommitments = Array.from({ length: 12 }, (_, i) => makeCommitment(i + 1));

    (api.commitments.list as jest.Mock).mockResolvedValue({
      commitments: manyCommitments,
      kpis: {
        receivableTotal: 12000000,
        payableTotal: 0,
        netBalance: 12000000,
        receivableInstallmentsCount: 12,
        overdueReceivableCount: 0,
        overduePayableCount: 0,
        noDateCount: 0,
        payableInstallmentsCount: 0,
        nextPayableDueDate: null,
      },
    });
    (api.contacts.list as jest.Mock).mockResolvedValue(sampleContacts);
    (api.accounts.list as jest.Mock).mockResolvedValue(sampleAccounts);
    (api.currencies.list as jest.Mock).mockResolvedValue([baseCurrency]);

    render(<CommitmentsPage />);

    await waitFor(() => {
      expect(screen.getByText('Prestamo personal')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Gestiona tus cuentas por cobrar y cuentas por pagar desde un solo lugar.'),
    ).toBeInTheDocument();

    const heroTitle = screen.getByText('Balance Pagos y Cobros');
    expect(heroTitle.closest('.bg-brand-gradient')).toBeInTheDocument();

    // Pagination page 1 shows items 1..10, not 11..12
    expect(screen.queryByText('Servicio proyecto 11')).not.toBeInTheDocument();
    expect(screen.getByText(/Mostrando 1–10 de 12 compromisos/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));
    expect(screen.getByText('Servicio proyecto 11')).toBeInTheDocument();
    expect(screen.getByText('Servicio proyecto 12')).toBeInTheDocument();
    expect(screen.queryByText('Prestamo personal')).not.toBeInTheDocument();
  });

  test('NewCommitmentPage displays updated copy, AccountPickerSheet prefiltering, and 3 concise checks', async () => {
    (api.contacts.list as jest.Mock).mockResolvedValue(sampleContacts);
    (api.accounts.summary as jest.Mock).mockResolvedValue(sampleAccounts);
    (api.currencies.list as jest.Mock).mockResolvedValue([baseCurrency]);

    render(<NewCommitmentPage />);

    await waitFor(() => {
      expect(screen.getByText('¿Quién y por qué concepto?')).toBeInTheDocument();
    });

    expect(screen.getByText('Me deben (Cuentas por cobrar)')).toBeInTheDocument();
    expect(screen.getByText('Debo (Cuentas por pagar)')).toBeInTheDocument();
    expect(screen.getByText('Importe y plan de vencimientos')).toBeInTheDocument();
    expect(screen.getByText('Origen contable')).toBeInTheDocument();

    const conceptInput = screen.getByPlaceholderText(
      'Servicio prestado, Venta de Producto, Prestamo, Compra...',
    );
    expect(conceptInput).toBeInTheDocument();

    // Initial missing checks (exact 3 items)
    expect(screen.getByText('Contacto: Falta seleccionar')).toBeInTheDocument();
    expect(screen.getByText('Monto y cuotas: Ingresa monto > 0')).toBeInTheDocument();
    expect(screen.getByText('Falta seleccionar cuenta')).toBeInTheDocument();

    // Select contact Don José via ContactsModal
    fireEvent.click(screen.getByRole('button', { name: /Seleccionar o crear contacto/i }));
    fireEvent.click(screen.getByText('Don José'));
    fireEvent.change(conceptInput, { target: { value: 'Landing web' } });

    // Enter amount with thousand separator formatting
    const amountInput = screen.getByPlaceholderText('0') as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '1000000' } });
    expect(amountInput.value).toBe('1.000.000');

    // Default CASH_TRANSFER origin strictly prefilters CASH_BANK accounts
    fireEvent.click(screen.getByText(/Elegir Caja o Banco/i));
    expect(screen.getByText('Caja Central')).toBeInTheDocument();
    expect(screen.queryByText('Desarrollo web')).not.toBeInTheDocument();
    expect(screen.queryByText('Servidores')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    // Switch to CATEGORY origin & verify AccountPickerSheet strictly prefilters INCOMES for INFLOW
    fireEvent.click(screen.getByRole('button', { name: /Venta o servicio/i }));
    fireEvent.click(screen.getByText(/Elegir categoría contable/i));

    expect(screen.getByText('Desarrollo web')).toBeInTheDocument();
    expect(screen.queryByText('Servidores')).not.toBeInTheDocument();
    expect(screen.queryByText('Caja Central')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Desarrollo web'));

    expect(screen.getByText('Contacto: Don José')).toBeInTheDocument();
    expect(screen.getByText('Monto y cuotas')).toBeInTheDocument();
    expect(screen.getByText('Cuenta: Desarrollo web')).toBeInTheDocument();
  });

  test('CommitmentDetailPage shows Cuentas por cobrar badge and puts Nombre first in edit form', async () => {
    const commitment = makeCommitment(1, 'INFLOW');
    (api.commitments.get as jest.Mock).mockResolvedValue(commitment);
    (api.contacts.list as jest.Mock).mockResolvedValue(sampleContacts);
    (api.accounts.list as jest.Mock).mockResolvedValue(sampleAccounts);
    (api.currencies.list as jest.Mock).mockResolvedValue([baseCurrency]);

    render(<CommitmentDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Cuentas por cobrar')).toBeInTheDocument();
    });
    expect(screen.queryByText('Me deben')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Editar/i }));

    const labels = Array.from(document.querySelectorAll('aside form label')).map((el) =>
      el.textContent?.trim(),
    );
    expect(labels[0]).toBe('Nombre');
    expect(labels[1]).toBe('Contacto');
    expect(labels[2]).toBe('Notas');
  });
});
