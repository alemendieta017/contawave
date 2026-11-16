import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { ForecastMobileView } from '../components/reports/ForecastMobileView';
import { AccountForecastItem, MonthForecastItem } from '../components/reports/ForecastMatrixGrid';

const mockBaseCurrency = {
  code: 'PYG',
  symbol: '₲',
  decimalPlaces: 0,
};

const mockMonthsCashFlow: MonthForecastItem[] = [
  {
    periodId: 'p-1',
    periodName: '2026-01',
    status: 'CLOSED',
    isReal: true,
    initialCash: 10000000,
    ingresosOperativos: 5000000,
    entradasActivoPasivo: 1000000,
    totalEntradas: 6000000,
    egresosOperativos: 3000000,
    salidasActivoPasivo: 500000,
    totalSalidas: 3500000,
    netFlow: 2500000,
    finalCash: 12500000,
  },
];

const mockAccountsCashFlow: AccountForecastItem[] = [
  {
    accountId: 'acc-1',
    accountName: 'Ventas de Servicios',
    accountType: 'INCOME',
    parentId: null,
    values: { 'p-1': 5000000 },
  },
  {
    accountId: 'acc-2',
    accountName: 'Alquiler Oficina',
    accountType: 'EXPENSE',
    parentId: null,
    values: { 'p-1': 3000000 },
  },
  {
    accountId: 'acc-3',
    accountName: 'Cobro Préstamo',
    accountType: 'ASSET',
    parentId: null,
    values: { 'p-1': 1000000 },
  },
  {
    accountId: 'acc-4',
    accountName: 'Pago Proveedores Pasivo',
    accountType: 'LIABILITY',
    parentId: null,
    values: { 'p-1': -500000 },
  },
];

describe('ForecastMobileView Component', () => {
  it('renders cash flow mobile view headers, KPIs, and accounts without negative signs', () => {
    render(
      <ForecastMobileView
        type="CASH_FLOW"
        months={mockMonthsCashFlow}
        accounts={mockAccountsCashFlow}
        activePeriodName="2026-01"
        baseCurrency={mockBaseCurrency}
      />,
    );

    // Header & Badge
    expect(screen.getByText('Caja Proyectada')).toBeInTheDocument();
    expect(screen.getByText('• Enero 2026')).toBeInTheDocument();
    expect(screen.getByText('Real')).toBeInTheDocument();

    // Summary KPIs
    expect(screen.getByText('Saldo Inicial')).toBeInTheDocument();
    expect(screen.getByText('Entradas')).toBeInTheDocument();
    expect(screen.getByText('Salidas')).toBeInTheDocument();

    // Sections & Totals
    expect(screen.getByText('Total Entradas')).toBeInTheDocument();
    expect(screen.getByText('Total Salidas')).toBeInTheDocument();

    // Accounts rendered
    expect(screen.getByText('Ventas de Servicios')).toBeInTheDocument();
    expect(screen.getByText('Alquiler Oficina')).toBeInTheDocument();
    expect(screen.getAllByText('Cobro Préstamo')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Pago Proveedores Pasivo')[0]).toBeInTheDocument();

    // Expense values must be positive, no negative format like "- ₲" or "-₲"
    const bodyText = document.body.textContent || '';
    expect(bodyText).not.toContain('- ₲ 3.000.000');
    expect(bodyText).not.toContain('-₲ 3.000.000');
    expect(bodyText).not.toContain('- ₲ 500.000');
    expect(bodyText).not.toContain('-₲ 500.000');
  });

  it('renders income statement mobile view correctly', () => {
    const mockMonthsIncome: MonthForecastItem[] = [
      {
        periodId: 'p-1',
        periodName: '2026-01',
        isReal: false,
        income: 10000000,
        expense: 6000000,
        netProfit: 4000000,
      },
    ];

    const mockAccountsIncome: AccountForecastItem[] = [
      {
        accountId: 'acc-inc',
        accountName: 'Honorarios Profesionales',
        accountType: 'INCOME',
        parentId: null,
        values: { 'p-1': 10000000 },
      },
      {
        accountId: 'acc-exp',
        accountName: 'Servicios Básicos',
        accountType: 'EXPENSE',
        parentId: null,
        values: { 'p-1': 6000000 },
      },
    ];

    render(
      <ForecastMobileView
        type="INCOME_STATEMENT"
        months={mockMonthsIncome}
        accounts={mockAccountsIncome}
        activePeriodName="2026-01"
        baseCurrency={mockBaseCurrency}
      />,
    );

    expect(screen.getByText('Resultados Proyectados')).toBeInTheDocument();
    expect(screen.getByText('• Enero 2026')).toBeInTheDocument();
    expect(screen.getByText('Proyectado')).toBeInTheDocument();

    // KPIs
    expect(screen.getByText('Resultado')).toBeInTheDocument();
    expect(screen.getByText('Margen')).toBeInTheDocument();

    // Accounts
    expect(screen.getByText('Honorarios Profesionales')).toBeInTheDocument();
    expect(screen.getByText('Servicios Básicos')).toBeInTheDocument();

    // Subtotal card
    expect(screen.getByText('Resultado Neto (P&L)')).toBeInTheDocument();
  });

  it('allows collapsing and expanding accordion sections in mobile view', () => {
    render(
      <ForecastMobileView
        type="CASH_FLOW"
        months={mockMonthsCashFlow}
        accounts={mockAccountsCashFlow}
        activePeriodName="2026-01"
        baseCurrency={mockBaseCurrency}
      />,
    );

    expect(screen.getByText('Ventas de Servicios')).toBeInTheDocument();

    // Click to collapse Ingresos section
    const incomeHeader = screen.getByText('Ingresos');
    fireEvent.click(incomeHeader);

    // Account should be hidden
    expect(screen.queryByText('Ventas de Servicios')).not.toBeInTheDocument();

    // Click again to expand
    fireEvent.click(incomeHeader);
    expect(screen.getByText('Ventas de Servicios')).toBeInTheDocument();
  });

  it('renders Actual badge and expands contactBreakdown sub-rows on mobile', () => {
    const monthsActual: MonthForecastItem[] = [
      {
        periodId: 'p-cur',
        periodName: '2026-02',
        status: 'OPEN',
        isReal: false,
        isCurrent: true,
        periodStatus: 'ACTUAL',
        initialCash: 1000,
        ingresosOperativos: 0,
        entradasActivoPasivo: 900,
        totalEntradas: 900,
        egresosOperativos: 0,
        salidasActivoPasivo: 0,
        totalSalidas: 0,
        netFlow: 900,
        finalCash: 1900,
      },
    ];

    const accountsWithContact: AccountForecastItem[] = [
      {
        accountId: 'ar-1',
        accountName: 'Cuentas por Cobrar',
        accountType: 'ASSET',
        systemRole: 'ACCOUNTS_RECEIVABLE',
        parentId: null,
        values: { 'p-cur': 900 },
        inflowValues: { 'p-cur': 900 },
        outflowValues: { 'p-cur': 0 },
        contactBreakdown: [
          {
            contactId: 'c-1',
            contactName: 'Empresa Beta',
            amount: 900,
            valuesByPeriod: { 'p-cur': 900 },
          },
        ],
      },
    ];

    render(
      <ForecastMobileView
        type="CASH_FLOW"
        months={monthsActual}
        accounts={accountsWithContact}
        activePeriodName="2026-02"
        baseCurrency={mockBaseCurrency}
      />,
    );

    expect(screen.getByText('Actual')).toBeInTheDocument();
    expect(screen.getByText('Cuentas por Cobrar')).toBeInTheDocument();
    expect(screen.queryByText(/Empresa Beta/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Expandir'));
    expect(screen.getByText(/└─ Empresa Beta/)).toBeInTheDocument();
  });
});
