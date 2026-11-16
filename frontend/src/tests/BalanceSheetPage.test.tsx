import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BalanceSheetPage from '../app/reports/balance-sheet/page';
import { api } from '../services/api';

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
    periods: {
      list: jest.fn(),
    },
    currencies: {
      list: jest.fn(),
    },
    reports: {
      balanceSheet: jest.fn(),
    },
  },
}));

describe('BalanceSheetPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders loading to loaded Balance Sheet without breaking React Hooks rules and expands contact breakdown', async () => {
    (api.periods.list as jest.Mock).mockResolvedValue([
      { id: 'period-1', name: '2026-11', status: 'OPEN' },
    ]);
    (api.currencies.list as jest.Mock).mockResolvedValue([
      { id: 'cur-1', code: 'PYG', symbol: '₲', decimalPlaces: 0, isBase: true },
    ]);
    (api.reports.balanceSheet as jest.Mock).mockResolvedValue({
      mode: 'period',
      periodName: '2026-11',
      totalAssets: 1500000,
      totalLiabilities: 0,
      totalEquity: 1500000,
      balanced: true,
      assets: [
        {
          accountId: 'ar-1',
          name: 'Cuentas por Cobrar',
          balance: 1500000,
          contactBreakdown: [
            {
              contactId: 'c-1',
              contactName: 'Don José',
              amount: 1500000,
              hasNoDate: false,
            },
          ],
        },
      ],
      liabilities: [],
      equity: [
        {
          accountId: 'eq-1',
          name: 'Capital',
          balance: 1500000,
        },
      ],
    });

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<BalanceSheetPage />);

    expect(screen.getByText(/Cargando datos del reporte/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Cuentas por Cobrar')).toBeInTheDocument();
    });

    const expandButton = screen.getByRole('button', { name: /Expandir Cuentas por Cobrar/i });
    fireEvent.click(expandButton);

    expect(screen.getByText(/Don José/i)).toBeInTheDocument();
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
