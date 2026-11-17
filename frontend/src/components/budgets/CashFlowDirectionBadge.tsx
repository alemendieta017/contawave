'use client';

import React from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { BudgetMatrixSectionKey, CashFlowDirection } from '@sistema-contable/shared';
import { cn } from '../../lib/utils';

export interface CashFlowDirectionBadgeProps {
  direction: CashFlowDirection;
  sectionKey?: BudgetMatrixSectionKey | string;
  accountType?: string;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
}

/**
 * Subtle, borderless inline flow-direction indicator for Asset and Liability budget rows.
 * Uses muted typography rather than heavy pills or alarmist red arrows to preserve table hierarchy.
 */
export const CashFlowDirectionBadge: React.FC<CashFlowDirectionBadgeProps> = ({
  direction,
  onClick,
  className,
}) => {
  const isOutflow = direction === CashFlowDirection.EGRESO_EFECTIVO;

  const label = isOutflow ? 'Salida' : 'Entrada';
  const title = isOutflow ? 'Salida de efectivo' : 'Entrada de efectivo';

  const baseClass = cn(
    'inline-flex items-center gap-1 text-xs font-normal whitespace-nowrap shrink-0 select-none rounded transition-colors',
    isOutflow ? 'text-muted-foreground' : 'text-emerald-600/90 dark:text-emerald-400/90',
    onClick &&
      'cursor-pointer hover:text-foreground hover:underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    className,
  );

  const content = (
    <>
      <span aria-hidden="true" className="text-border select-none">
        ·
      </span>
      {isOutflow ? (
        <ArrowDownRight
          className="w-3 h-3 opacity-75 shrink-0"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      ) : (
        <ArrowUpRight
          className="w-3 h-3 opacity-85 shrink-0"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      )}
      <span>{label}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-label={`${label} (${title})`}
        className={baseClass}
      >
        {content}
      </button>
    );
  }

  return (
    <span title={title} aria-label={`${label} (${title})`} className={baseClass}>
      {content}
    </span>
  );
};
