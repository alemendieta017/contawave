import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountType, LoanDto } from '@sistema-contable/shared';
import LoansPage from '../app/loans/page';
import LoanDetailPage from '../app/loans/[id]/page';
import LoanPlanForm, { CurrencyItem } from '../components/loans/LoanPlanForm';
import PayLoanInstallmentModal from '../components/loans/PayLoanInstallmentModal';
import ReverseLoanPaymentModal from '../components/loans/ReverseLoanPaymentModal';
import DeleteLoanModal from '../components/loans/DeleteLoanModal';
import { api } from '../services/api';
import type { AccountOption } from '../types/account';

const mockPush = jest.fn();
let mockRouteParams: { id?: string } = { id: 'loan-1' };

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
    loans: {
      list: jest.fn(),
      get: jest.fn(),
      create: jest.fn(),
      updatePlan: jest.fn(),
      payInstallment: jest.fn(),
      reverseAllocation: jest.fn(),
      delete: jest.fn(),
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

const baseCurrency: CurrencyItem = {
  id: 'cur-pyg',
  code: 'PYG',
  name: 'Guaraní Paraguayo',
  symbol: '₲',
  decimalPlaces: 0,
  isBase: true,
};

const sampleAccounts: AccountOption[] = [
  {
    id: 'acc-bank',
    name: 'Banco Itaú',
    type: AccountType.ASSET,
    isCashOrBank: true,
    status: 'ACTIVE',
    balance: 15000000,
    currencyCode: 'PYG',
    currencySymbol: '₲',
    decimalPlaces: 0,
  },
  {
    id: 'acc-int',
    name: 'Intereses y Cargos Financieros',
    type: AccountType.EXPENSE,
    isCashOrBank: false,
    status: 'ACTIVE',
    balance: 0,
    currencyCode: 'PYG',
    currencySymbol: '₲',
    decimalPlaces: 0,
  },
  {
    id: 'acc-seg',
    name: 'Seguros',
    type: AccountType.EXPENSE,
    isCashOrBank: false,
    status: 'ACTIVE',
    balance: 0,
    currencyCode: 'PYG',
    currencySymbol: '₲',
    decimalPlaces: 0,
  },
  {
    id: 'acc-inc',
    name: 'Descuentos Obtenidos',
    type: AccountType.INCOME,
    isCashOrBank: false,
    status: 'ACTIVE',
    balance: 0,
    currencyCode: 'PYG',
    currencySymbol: '₲',
    decimalPlaces: 0,
  },
];

function makeSampleLoan(overrides?: Partial<LoanDto>): LoanDto {
  return {
    id: 'loan-1',
    name: 'Préstamo Auto Itaú',
    currencyId: 'cur-pyg',
    currencyCode: 'PYG',
    currencySymbol: '₲',
    decimalPlaces: 0,
    rateToBase: 1,
    initialPrincipal: 1000000,
    annualRate: 13.5,
    openingDate: '2026-10-15',
    startInstallmentNumber: 1,
    totalInstallmentsCount: 2,
    liabilityAccountId: 'acc-loan-1',
    liabilityAccountName: 'Préstamo Auto Itaú',
    defaultPaymentAccountId: 'acc-bank',
    defaultPaymentAccountName: 'Banco Itaú',
    initialTransactionId: 'tx-init-1',
    initialTransaction: {
      id: 'tx-init-1',
      accountingDate: '2026-10-15',
      description: '[Préstamo] Desembolso · Préstamo Auto Itaú',
      status: 'POSTED',
      entries: [],
    },
    status: 'ACTIVE',
    paidPrincipal: 500000,
    pendingPrincipal: 500000,
    paidChargesTotal: 50000,
    totalPaid: 550000,
    progressPercent: 50,
    paidInstallmentsCount: 1,
    pendingInstallmentsCount: 1,
    nextDueDate: '2026-12-05',
    nextInstallmentNumber: 2,
    nextInstallmentPendingTotal: 560000,
    isNextOverdue: false,
    activeMovementsCount: 1,
    deleteActionPreview: 'BLOCKED',
    chargeColumns: [
      {
        id: 'col-int',
        name: 'Interés',
        expenseAccountId: 'acc-int',
        expenseAccountName: 'Intereses y Cargos Financieros',
        isActive: true,
        sortOrder: 0,
        hasAllocations: true,
      },
      {
        id: 'col-seg',
        name: 'Seguros',
        expenseAccountId: 'acc-seg',
        expenseAccountName: 'Seguros',
        isActive: false,
        sortOrder: 1,
        hasAllocations: false,
      },
    ],
    installments: [
      {
        id: 'inst-1',
        loanId: 'loan-1',
        installmentNumber: 1,
        dueDate: '2026-11-05',
        principalAmount: 500000,
        charges: { 'col-int': 50000, 'col-seg': 10000 },
        paidPrincipal: 500000,
        pendingPrincipal: 0,
        paidCharges: { 'col-int': 50000, 'col-seg': 0 },
        pendingCharges: { 'col-int': 0, 'col-seg': 0 },
        scheduledTotal: 560000,
        paidTotal: 550000,
        pendingTotal: 0,
        status: 'PAID',
        isOverdue: false,
        allocations: [
          {
            id: 'alloc-1',
            installmentId: 'inst-1',
            transactionId: 'tx-pay-1',
            principalJournalEntryId: 'je-1',
            allocatedPrincipal: 500000,
            allocatedCharges: { 'col-int': 50000 },
            totalAmount: 550000,
            paidAt: '2026-11-05',
            paymentAccountId: 'acc-bank',
            paymentAccountName: 'Banco Itaú',
            createdAt: '2026-11-05T10:00:00Z',
          },
        ],
      },
      {
        id: 'inst-2',
        loanId: 'loan-1',
        installmentNumber: 2,
        dueDate: '2026-12-05',
        principalAmount: 500000,
        charges: { 'col-int': 60000, 'col-seg': 0 },
        paidPrincipal: 0,
        pendingPrincipal: 500000,
        paidCharges: { 'col-int': 0, 'col-seg': 0 },
        pendingCharges: { 'col-int': 60000, 'col-seg': 0 },
        scheduledTotal: 560000,
        paidTotal: 0,
        pendingTotal: 560000,
        status: 'PENDING',
        isOverdue: false,
        allocations: [],
      },
    ],
    createdAt: '2026-10-15T10:00:00Z',
    ...overrides,
  };
}

describe('Loans UI & Components (Spec 02)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { id: 'loan-1' };
  });

  test('LoansPage renders 4 KPIs, expands upcoming installments, toggles Agenda de Cuotas, and opens Pay modal', async () => {
    const sampleLoan = makeSampleLoan();
    (api.loans.list as jest.Mock).mockResolvedValue({
      kpis: {
        totalPendingPrincipalBase: 500000,
        monthlyLoadBase: 560000,
        activeLoansCount: 1,
        settledLoansCount: 0,
        pendingInstallmentsCount: 1,
        paidInstallmentsCount: 1,
        nextInstallment: {
          loanId: 'loan-1',
          loanName: 'Préstamo Auto Itaú',
          installmentId: 'inst-2',
          installmentNumber: 2,
          dueDate: '2026-12-05',
          pendingTotal: 560000,
          pendingTotalBase: 560000,
          currencyCode: 'PYG',
          currencySymbol: '₲',
          decimalPlaces: 0,
          isOverdue: false,
        },
      },
      loans: [sampleLoan],
    });
    (api.accounts.summary as jest.Mock).mockResolvedValue(sampleAccounts);
    (api.currencies.list as jest.Mock).mockResolvedValue([baseCurrency]);

    render(<LoansPage />);

    await waitFor(() => {
      expect(screen.getByText('Cartera de Préstamos')).toBeInTheDocument();
    });

    // 4 KPIs including brand gradient hero
    const [heroLabel] = screen.getAllByText('Capital Pendiente');
    expect(heroLabel.closest('.bg-brand-gradient')).toBeInTheDocument();
    expect(screen.getByText('Próxima Cuota')).toBeInTheDocument();
    expect(screen.getByText('Carga Mensual')).toBeInTheDocument();
    expect(screen.getByText('Créditos Activos')).toBeInTheDocument();

    // First active loan expanded showing pending installment #2 and dynamic column
    expect(screen.getByText('#2')).toBeInTheDocument();

    // Switch to Agenda de Cuotas
    fireEvent.click(screen.getByRole('button', { name: /Agenda de Cuotas/i }));
    expect(screen.getByText(/Cuota #2 \/ 2/i)).toBeInTheDocument();

    // Open Pay modal from Agenda row
    fireEvent.click(screen.getByRole('button', { name: 'Pagar' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Pagar cuota #2/i)).toBeInTheDocument();
  });

  test('LoanPlanForm create mode supports recalculate + Deshacer, custom charge column drawer, and submit', async () => {
    (api.loans.create as jest.Mock).mockResolvedValue(makeSampleLoan({ id: 'loan-created' }));

    render(<LoanPlanForm mode="create" accounts={sampleAccounts} currencies={[baseCurrency]} />);

    const nameInput = screen.getByLabelText(/Nombre del préstamo/i);
    fireEvent.change(nameInput, { target: { value: 'Préstamo Personal' } });
    expect(
      screen.getByText(/Se creará la cuenta de pasivo «Préstamo Personal»/i),
    ).toBeInTheDocument();

    // Modify calculator count from 12 -> 6 and recalculate + Deshacer
    const countInput = screen.getByLabelText(/Cuotas totales/i) as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: /Recalcular tabla/i }));

    expect(screen.getByText(/\(6 cuotas #1 a #6\)/i)).toBeInTheDocument();
    const undoBtn = screen.getByRole('button', { name: 'Deshacer' });
    fireEvent.click(undoBtn);
    expect(screen.getByText(/\(12 cuotas #1 a #12\)/i)).toBeInTheDocument();

    // Open column drawer & add preset fixed column
    fireEvent.click(screen.getByRole('button', { name: /Agregar columna de cargo/i }));
    fireEvent.click(screen.getByRole('button', { name: /Gasto fijo mensual/i }));
    fireEvent.click(screen.getByRole('button', { name: /Aplicar columna/i }));

    expect(screen.getByText('Gastos Adm.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar Préstamo' }));

    await waitFor(() => {
      expect(api.loans.create).toHaveBeenCalledTimes(1);
    });
    expect(api.loans.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Préstamo Personal',
        openingMode: 'NEW',
        chargeColumns: expect.arrayContaining([
          expect.objectContaining({ name: 'Interés', expenseAccountId: 'acc-int' }),
          expect.objectContaining({ name: 'Gastos Adm.' }),
        ]),
      }),
    );
    expect(mockPush).toHaveBeenCalledWith('/loans/loan-created');
  });

  test('LoanPlanForm edit mode protects PAID installments and requires capital adjustment on delta != 0', async () => {
    const sampleLoan = makeSampleLoan();
    (api.loans.updatePlan as jest.Mock).mockResolvedValue(sampleLoan);

    render(
      <LoanPlanForm
        mode="edit"
        initialLoan={sampleLoan}
        accounts={sampleAccounts}
        currencies={[baseCurrency]}
      />,
    );

    // Tab 'Incluir pagadas' shows protected PAID row
    fireEvent.click(screen.getByRole('tab', { name: 'Incluir pagadas' }));
    expect(screen.getByText('Pagada · Protegida')).toBeInTheDocument();
    expect(screen.queryByLabelText('Capital cuota #1')).not.toBeInTheDocument();

    // Change pending principal of #2 from 500,000 -> 400,000 (-100,000)
    const cap2Input = screen.getByLabelText('Capital cuota #2');
    fireEvent.change(cap2Input, { target: { value: '400000' } });

    expect(screen.getByText(/El capital pendiente cambió en - ₲ 100.000/i)).toBeInTheDocument();

    // Pick CAPITAL_ADJUSTMENT
    fireEvent.click(screen.getByRole('button', { name: /Ajuste contra Capital/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios del préstamo' }));

    await waitFor(() => {
      expect(api.loans.updatePlan).toHaveBeenCalledTimes(1);
    });
    expect(api.loans.updatePlan).toHaveBeenCalledWith(
      'loan-1',
      expect.objectContaining({
        capitalAdjustment: expect.objectContaining({ type: 'CAPITAL_ADJUSTMENT' }),
      }),
    );
    expect(mockPush).toHaveBeenCalledWith('/loans/loan-1');
  });

  test('PayLoanInstallmentModal, ReverseLoanPaymentModal, DeleteLoanModal, and LoanDetailPage interactions work cleanly', async () => {
    const loan = makeSampleLoan();
    const pendingInst = loan.installments[1];
    const paidInst = loan.installments[0];
    const onPaySuccess = jest.fn();

    (api.loans.payInstallment as jest.Mock).mockResolvedValue(loan);

    const { rerender } = render(
      <PayLoanInstallmentModal
        isOpen={true}
        onClose={jest.fn()}
        loan={loan}
        installment={pendingInst}
        accounts={sampleAccounts}
        onSuccess={onPaySuccess}
      />,
    );

    const principalField = screen.getByLabelText(/Capital \(₲\)/i) as HTMLInputElement;
    expect(principalField.value).toBe('500.000');

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pago' }));
    await waitFor(() => {
      expect(api.loans.payInstallment).toHaveBeenCalledWith(
        'inst-2',
        expect.objectContaining({
          paymentAccountId: 'acc-bank',
          allocatedPrincipal: 500000,
          allocatedCharges: { 'col-int': 60000 },
        }),
      );
    });
    expect(onPaySuccess).toHaveBeenCalled();

    // Reverse modal
    const onRevSuccess = jest.fn();
    (api.loans.reverseAllocation as jest.Mock).mockResolvedValue(loan);
    rerender(
      <ReverseLoanPaymentModal
        isOpen={true}
        onClose={jest.fn()}
        loan={loan}
        installment={paidInst}
        onSuccess={onRevSuccess}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reversión' }));
    await waitFor(() => {
      expect(api.loans.reverseAllocation).toHaveBeenCalledWith('alloc-1');
    });

    // Delete modal: BLOCKED vs DELETE vs CANCEL
    const onDeleted = jest.fn();
    (api.loans.delete as jest.Mock).mockResolvedValue({ success: true, action: 'DELETED' });
    rerender(
      <DeleteLoanModal
        isOpen={true}
        onClose={jest.fn()}
        loan={makeSampleLoan({ deleteActionPreview: 'BLOCKED', activeMovementsCount: 2 })}
        onDeleted={onDeleted}
      />,
    );
    expect(
      screen.getByText(/No se puede eliminar todavía \(2 movimientos activos\)/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirmar/i })).not.toBeInTheDocument();

    rerender(
      <DeleteLoanModal
        isOpen={true}
        onClose={jest.fn()}
        loan={makeSampleLoan({ deleteActionPreview: 'DELETE', activeMovementsCount: 0 })}
        onDeleted={onDeleted}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar eliminación' }));
    await waitFor(() => {
      expect(api.loans.delete).toHaveBeenCalledWith('loan-1');
    });

    rerender(
      <DeleteLoanModal
        isOpen={true}
        onClose={jest.fn()}
        loan={makeSampleLoan({ deleteActionPreview: 'CANCEL', activeMovementsCount: 0 })}
        onDeleted={onDeleted}
      />,
    );
    expect(screen.getByRole('button', { name: 'Confirmar anulación' })).toBeInTheDocument();

    // LoanDetailPage displays archived column with historical amounts and action links
    (api.loans.get as jest.Mock).mockResolvedValue(loan);
    (api.accounts.summary as jest.Mock).mockResolvedValue(sampleAccounts);
    render(<LoanDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Préstamo Auto Itaú')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /Editar préstamo/i })).toHaveAttribute(
      'href',
      '/loans/loan-1/edit',
    );
    expect(screen.getByText('(archivada)')).toBeInTheDocument();
  });
});
