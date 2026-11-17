import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import DailyView from '../components/DailyView';

describe('DailyView Sorting Order', () => {
  const baseCurrency = { code: 'USD', symbol: '$', decimalPlaces: 2 };
  const mockOnReverse = jest.fn();
  const mockOnDelete = jest.fn();

  test('should render transactions of the same day in descending order by createdAt', () => {
    const transactions = [
      {
        id: 'tx-1',
        accountingDate: '2026-08-04',
        createdAt: '2026-08-04T10:00:00.000Z',
        description: 'Asiento inicial',
        entries: [
          {
            id: 'e-1',
            accountId: 'acc-1',
            entryType: 'DEBIT' as const,
            amount: 500,
            account: { id: 'acc-1', name: 'Caja', type: 'ASSET' },
          },
          {
            id: 'e-2',
            accountId: 'acc-2',
            entryType: 'CREDIT' as const,
            amount: 500,
            account: { id: 'acc-2', name: 'Capital', type: 'EQUITY' },
          },
        ],
      },
      {
        id: 'tx-2',
        accountingDate: '2026-08-04',
        createdAt: '2026-08-04T14:30:00.000Z',
        description: 'Salario',
        entries: [
          {
            id: 'e-3',
            accountId: 'acc-3',
            entryType: 'DEBIT' as const,
            amount: 1500,
            account: { id: 'acc-3', name: 'Sueldos', type: 'EXPENSE' },
          },
          {
            id: 'e-4',
            accountId: 'acc-1',
            entryType: 'CREDIT' as const,
            amount: 1500,
            account: { id: 'acc-1', name: 'Caja', type: 'ASSET' },
          },
        ],
      },
    ];

    render(
      <DailyView
        transactions={transactions}
        onReverse={mockOnReverse}
        onDelete={mockOnDelete}
        baseCurrency={baseCurrency}
      />,
    );

    const asientoElem = screen.getByText('Asiento inicial');
    const salarioElem = screen.getByText('Salario');

    expect(asientoElem).toBeInTheDocument();
    expect(salarioElem).toBeInTheDocument();

    // Check DOM position: Salario (created later at 14:30) must appear before Asiento inicial (created at 10:00)
    const positionCompare = salarioElem.compareDocumentPosition(asientoElem);
    expect(positionCompare & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('DailyView Transaction Ownership & Reversal Guards', () => {
  const baseCurrency = { code: 'PYG', symbol: '₲', decimalPlaces: 0 };

  const makeTx = (overrides: Record<string, any> = {}) => ({
    id: 'tx-1',
    accountingDate: '2026-11-16',
    createdAt: '2026-11-16T10:00:00Z',
    description: 'Movimiento de prueba',
    status: 'POSTED',
    reversalOfId: null,
    originModule: 'MANUAL' as const,
    originEntityId: null,
    entries: [
      {
        id: 'e-1',
        accountId: 'acc-1',
        entryType: 'DEBIT' as const,
        amount: 100000,
        account: { id: 'acc-1', name: 'Supermercado', type: 'EXPENSE' },
      },
      {
        id: 'e-2',
        accountId: 'acc-2',
        entryType: 'CREDIT' as const,
        amount: 100000,
        account: { id: 'acc-2', name: 'Banco Principal', type: 'ASSET' },
      },
    ],
    ...overrides,
  });

  test('renders full actions for MANUAL POSTED transactions', () => {
    render(
      <DailyView
        transactions={[makeTx()]}
        onReverse={jest.fn()}
        onDelete={jest.fn()}
        baseCurrency={baseCurrency}
      />,
    );

    fireEvent.click(screen.getByText('Movimiento de prueba'));

    expect(screen.getByText('Eliminar')).toBeInTheDocument();
    expect(screen.getByText('Duplicar')).toBeInTheDocument();
    expect(screen.getByText('Editar')).toBeInTheDocument();
    expect(screen.getByText('Anular / Reversar')).toBeInTheDocument();
  });

  test('hides Edit, Delete, Duplicate, and Reverse for COMMITMENT transactions and links to parent module', () => {
    const tx = makeTx({
      id: 'tx-com',
      description: '[Cuentas por cobrar] Don José — Servicio',
      originModule: 'COMMITMENT',
      originEntityId: 'com-99',
    });

    render(
      <DailyView
        transactions={[tx]}
        onReverse={jest.fn()}
        onDelete={jest.fn()}
        baseCurrency={baseCurrency}
      />,
    );

    expect(screen.getByText('Pagos y Cobros')).toBeInTheDocument();
    fireEvent.click(screen.getByText('[Cuentas por cobrar] Don José — Servicio'));

    expect(screen.queryByText('Eliminar')).not.toBeInTheDocument();
    expect(screen.queryByText('Duplicar')).not.toBeInTheDocument();
    expect(screen.queryByText('Editar')).not.toBeInTheDocument();
    expect(screen.queryByText('Anular / Reversar')).not.toBeInTheDocument();

    const manageLink = screen.getByRole('link', { name: /Gestionar en Pagos y Cobros/i });
    expect(manageLink).toHaveAttribute('href', '/commitments/com-99');
  });

  test('hides Delete for REVERSED and reversal transactions even when MANUAL', () => {
    const reversedTx = makeTx({
      id: 'tx-rev-orig',
      description: 'Asiento original anulado',
      status: 'REVERSED',
    });
    const reversalTx = makeTx({
      id: 'tx-rev-entry',
      description: 'Reversión de asiento: Asiento original anulado',
      reversalOfId: 'tx-rev-orig',
    });

    render(
      <DailyView
        transactions={[reversedTx, reversalTx]}
        onReverse={jest.fn()}
        onDelete={jest.fn()}
        baseCurrency={baseCurrency}
      />,
    );

    fireEvent.click(screen.getByText('Asiento original anulado'));
    expect(screen.queryByText('Eliminar')).not.toBeInTheDocument();
    expect(screen.getByText('Duplicar')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Reversión de asiento: Asiento original anulado'));
    expect(screen.queryByText('Eliminar')).not.toBeInTheDocument();
  });
});
