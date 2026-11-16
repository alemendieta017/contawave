import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ForecastMatrixGrid,
  AccountForecastItem,
  MonthForecastItem,
} from '../components/reports/ForecastMatrixGrid';

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
  {
    periodId: 'p-2',
    periodName: '2026-02',
    status: 'OPEN',
    isReal: false,
    initialCash: 12500000,
    ingresosOperativos: 5500000,
    entradasActivoPasivo: 0,
    totalEntradas: 5500000,
    egresosOperativos: 3200000,
    salidasActivoPasivo: 500000,
    totalSalidas: 3700000,
    netFlow: 1800000,
    finalCash: 14300000,
  },
];

const mockAccountsCashFlow: AccountForecastItem[] = [
  {
    accountId: 'acc-1',
    accountName: 'Ventas de Servicios',
    accountType: 'INCOME',
    parentId: null,
    values: { 'p-1': 5000000, 'p-2': 5500000 },
  },
  {
    accountId: 'acc-2',
    accountName: 'Alquiler Oficina',
    accountType: 'EXPENSE',
    parentId: null,
    values: { 'p-1': 3000000, 'p-2': 3200000 },
  },
  {
    accountId: 'acc-3',
    accountName: 'Préstamo Bancario',
    accountType: 'LIABILITY',
    parentId: null,
    values: { 'p-1': 1000000, 'p-2': 0 },
  },
  {
    accountId: 'acc-4',
    accountName: 'Aporte de Capital',
    accountType: 'ASSET',
    parentId: null,
    values: { 'p-1': -500000, 'p-2': -500000 },
  },
];

describe('ForecastMatrixGrid Component', () => {
  it('renders cash flow matrix headers, badges, and account rows correctly', () => {
    render(
      <ForecastMatrixGrid
        type="CASH_FLOW"
        months={mockMonthsCashFlow}
        accounts={mockAccountsCashFlow}
        baseCurrency={mockBaseCurrency}
      />,
    );

    // Section headers and badges
    expect(screen.getByText('Concepto / Partida')).toBeInTheDocument();
    expect(screen.getByText('Ingresos')).toBeInTheDocument();
    expect(screen.getByText('Entradas Activo / Pasivo')).toBeInTheDocument();
    expect(screen.getByText('Egresos')).toBeInTheDocument();
    expect(screen.getByText('Salidas Activo / Pasivo')).toBeInTheDocument();

    // Accounts
    expect(screen.getByText('Ventas de Servicios')).toBeInTheDocument();
    expect(screen.getByText('Alquiler Oficina')).toBeInTheDocument();

    // Real and Proyectado pills
    expect(screen.getByText('Real')).toBeInTheDocument();
    expect(screen.getByText('Proyectado')).toBeInTheDocument();

    // Prominent Totals
    expect(screen.getByText('Total Entradas')).toBeInTheDocument();
    expect(screen.getByText('Total Salidas')).toBeInTheDocument();
    expect(screen.getByText('Flujo Neto')).toBeInTheDocument();
    expect(screen.getByText('SALDO FINAL DE CAJA')).toBeInTheDocument();
  });

  it('renders income statement matrix correctly', () => {
    const mockMonthsIncome: MonthForecastItem[] = [
      {
        periodId: 'p-1',
        periodName: '2026-01',
        isReal: true,
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
      <ForecastMatrixGrid
        type="INCOME_STATEMENT"
        months={mockMonthsIncome}
        accounts={mockAccountsIncome}
        baseCurrency={mockBaseCurrency}
      />,
    );

    expect(screen.getByText('Ingresos')).toBeInTheDocument();
    expect(screen.getByText('Honorarios Profesionales')).toBeInTheDocument();
    expect(screen.getByText('Gastos')).toBeInTheDocument();
    expect(screen.getByText('Servicios Básicos')).toBeInTheDocument();
    expect(screen.getByText('Resultado Neto (P&L)')).toBeInTheDocument();
  });

  it('allows collapsing and expanding sections', () => {
    render(
      <ForecastMatrixGrid
        type="CASH_FLOW"
        months={mockMonthsCashFlow}
        accounts={mockAccountsCashFlow}
        baseCurrency={mockBaseCurrency}
      />,
    );

    expect(screen.getByText('Ventas de Servicios')).toBeInTheDocument();

    // Click to collapse income section
    const incomeSectionHeader = screen.getByText('Ingresos');
    fireEvent.click(incomeSectionHeader);

    // Account should now be hidden
    expect(screen.queryByText('Ventas de Servicios')).not.toBeInTheDocument();

    // Click again to expand
    fireEvent.click(incomeSectionHeader);
    expect(screen.getByText('Ventas de Servicios')).toBeInTheDocument();
  });

  it('renders Actual badge, separates AR/AP directional inflows/outflows, and expands contactBreakdown sub-rows', () => {
    const monthsWithActual: MonthForecastItem[] = [
      {
        periodId: 'p-1',
        periodName: '2026-01',
        status: 'CLOSED',
        isReal: true,
        periodStatus: 'REAL',
        initialCash: 1000,
        ingresosOperativos: 0,
        entradasActivoPasivo: 500,
        totalEntradas: 500,
        egresosOperativos: 0,
        salidasActivoPasivo: 200,
        totalSalidas: 200,
        netFlow: 300,
        finalCash: 1300,
      },
      {
        periodId: 'p-2',
        periodName: '2026-02',
        status: 'OPEN',
        isReal: false,
        isCurrent: true,
        periodStatus: 'ACTUAL',
        initialCash: 1300,
        ingresosOperativos: 0,
        entradasActivoPasivo: 700,
        totalEntradas: 700,
        egresosOperativos: 0,
        salidasActivoPasivo: 0,
        totalSalidas: 0,
        netFlow: 700,
        finalCash: 2000,
      },
    ];

    const accountsWithContacts: AccountForecastItem[] = [
      {
        accountId: 'ar-1',
        accountName: 'Cuentas por Cobrar',
        accountType: 'ASSET',
        systemRole: 'ACCOUNTS_RECEIVABLE',
        parentId: null,
        values: { 'p-1': 500, 'p-2': 700 },
        inflowValues: { 'p-1': 500, 'p-2': 700 },
        outflowValues: { 'p-1': 0, 'p-2': 0 },
        contactBreakdown: [
          {
            contactId: 'c-1',
            contactName: 'Cliente Norte',
            amount: 1200,
            valuesByPeriod: { 'p-1': 500, 'p-2': 700 },
          },
        ],
      },
      {
        accountId: 'ap-1',
        accountName: 'Cuentas por Pagar',
        accountType: 'LIABILITY',
        systemRole: 'ACCOUNTS_PAYABLE',
        parentId: null,
        values: { 'p-1': -200, 'p-2': 0 },
        inflowValues: { 'p-1': 0, 'p-2': 0 },
        outflowValues: { 'p-1': 200, 'p-2': 0 },
        contactBreakdown: [
          {
            contactId: 'c-2',
            contactName: 'Proveedor Sur',
            amount: 200,
            valuesByPeriod: { 'p-1': 200, 'p-2': 0 },
          },
        ],
      },
    ];

    render(
      <ForecastMatrixGrid
        type="CASH_FLOW"
        months={monthsWithActual}
        accounts={accountsWithContacts}
        baseCurrency={mockBaseCurrency}
      />,
    );

    expect(screen.getByText('Real')).toBeInTheDocument();
    expect(screen.getByText('Actual')).toBeInTheDocument();
    expect(screen.queryByText('Híbrido')).not.toBeInTheDocument();

    // Zero-flow filtering ensures each control account renders once in its own direction
    expect(screen.getAllByText('Cuentas por Cobrar')).toHaveLength(1);
    expect(screen.getAllByText('Cuentas por Pagar')).toHaveLength(1);

    // Virtual contact sub-rows collapsed initially
    expect(screen.queryByText(/Cliente Norte/)).not.toBeInTheDocument();

    // Expand Cuentas por Cobrar
    const expandBtns = screen.getAllByTitle('Expandir');
    fireEvent.click(expandBtns[0]);
    expect(screen.getByText(/└─ Cliente Norte/)).toBeInTheDocument();
  });
});
