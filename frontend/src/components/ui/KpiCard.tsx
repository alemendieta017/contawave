import React from 'react';
import { cn } from '../../lib/utils';

export type KpiCardVariant = 'hero' | 'default' | 'emerald' | 'rose';

export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  footer?: React.ReactNode;
  variant?: KpiCardVariant;
  className?: string;
  labelClassName?: string;
  valueClassName?: string;
}

const CONTAINER_VARIANTS: Record<KpiCardVariant, string> = {
  hero: 'bg-brand-gradient text-white shadow-brand-glow relative overflow-hidden',
  default: 'bg-card text-card-foreground border border-border shadow-xs',
  emerald:
    'bg-card text-card-foreground border border-emerald-200/70 dark:border-emerald-900/50 shadow-xs',
  rose: 'bg-card text-card-foreground border border-rose-200/70 dark:border-rose-900/50 shadow-xs',
};

const LABEL_VARIANTS: Record<KpiCardVariant, string> = {
  hero: 'text-white/90',
  default: 'text-muted-foreground',
  emerald: 'text-emerald-700 dark:text-emerald-400',
  rose: 'text-rose-700 dark:text-rose-400',
};

const VALUE_VARIANTS: Record<KpiCardVariant, string> = {
  hero: 'text-white',
  default: 'text-foreground',
  emerald: 'text-foreground',
  rose: 'text-foreground',
};

export function KpiCard({
  label,
  value,
  icon,
  badge,
  footer,
  variant = 'default',
  className,
  labelClassName,
  valueClassName,
}: KpiCardProps) {
  const isHero = variant === 'hero';

  return (
    <div
      className={cn(
        'rounded-xl sm:rounded-2xl p-3 sm:p-5 flex flex-col justify-between gap-1.5 sm:gap-2 min-w-0',
        CONTAINER_VARIANTS[variant],
        className,
      )}
    >
      {isHero && (
        <div
          aria-hidden="true"
          className="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-white/10 blur-xl pointer-events-none"
        />
      )}

      <div className="relative z-10 flex items-start sm:items-center justify-between gap-1.5">
        <span
          className={cn(
            'text-xs font-bold uppercase tracking-wider leading-tight truncate',
            LABEL_VARIANTS[variant],
            labelClassName,
          )}
        >
          {label}
        </span>
        {badge}
        {icon && <div className="shrink-0">{icon}</div>}
      </div>

      <div className="relative z-10 min-w-0">
        <div
          className={cn(
            'text-lg sm:text-2xl font-bold tracking-tight tabular-nums truncate',
            VALUE_VARIANTS[variant],
            valueClassName,
          )}
        >
          {value}
        </div>
        {footer && <div className="mt-1">{footer}</div>}
      </div>
    </div>
  );
}
