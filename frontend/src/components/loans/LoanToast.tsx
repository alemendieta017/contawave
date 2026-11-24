'use client';

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface LoanToastData {
  id: number;
  message: string;
  onUndo?: () => void;
}

interface LoanToastProps {
  toast: LoanToastData | null;
  onDismiss: () => void;
}

export default function LoanToast({ toast, onDismiss }: LoanToastProps) {
  useEffect(() => {
    if (!toast) return;
    const duration = toast.onUndo ? 6500 : 3500;
    const timer = setTimeout(() => {
      onDismiss();
    }, duration);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed bottom-20 lg:bottom-6 right-4 z-50 max-w-md',
        'bg-primary text-primary-foreground px-4 py-3 rounded-xl shadow-xl',
        'flex items-center gap-3 text-xs font-semibold',
      )}
    >
      <span className="flex-1">{toast.message}</span>
      {toast.onUndo && (
        <button
          type="button"
          onClick={() => {
            const fn = toast.onUndo;
            onDismiss();
            fn?.();
          }}
          className="px-2.5 py-1 rounded-lg border border-current text-xs font-bold hover:opacity-85 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Deshacer
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Cerrar notificación"
        className="p-1 rounded-lg opacity-75 hover:opacity-100 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
