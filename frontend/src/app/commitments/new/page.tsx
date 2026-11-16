'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AccountType,
  CommitmentFlowDirection,
  CommitmentOriginType,
  ContactDto,
} from '@sistema-contable/shared';
import {
  ArrowLeft,
  Users,
  CheckCircle2,
  Wallet,
  Tag,
  Landmark,
  Calendar,
  CalendarOff,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { api } from '../../../services/api';
import { formatCurrency } from '../../../lib/utils';
import type { AccountOption } from '../../../types/account';
import {
  addFrequencyDate,
  formatAmountInput,
  getTodayLocalIso,
  normalizeAmountInput,
  parseNumericInput,
  splitAmountEvenly,
} from '../../../components/commitments/commitment-ui';
import ContactsModal from '../../../components/commitments/ContactsModal';
import AccountPickerSheet from '../../../components/transactions/AccountPickerSheet';
import AccountModal from '../../../components/AccountModal';

interface DraftInstallment {
  installmentNumber: number;
  amount: string;
  dueDate: string;
  noDate: boolean;
}

export default function NewCommitmentPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [direction, setDirection] = useState<CommitmentFlowDirection>('INFLOW');
  const [contactId, setContactId] = useState('');
  const [description, setDescription] = useState('');
  const [originDate, setOriginDate] = useState(getTodayLocalIso());
  const [notes, setNotes] = useState('');
  const [totalAmountInput, setTotalAmountInput] = useState('');

  // Schedule mode
  const [scheduleMode, setScheduleMode] = useState<'SINGLE' | 'INSTALLMENTS'>('SINGLE');
  const [singleDueDate, setSingleDueDate] = useState(getTodayLocalIso());
  const [singleNoDate, setSingleNoDate] = useState(false);

  const [installmentCount, setInstallmentCount] = useState(3);
  const [frequency, setFrequency] = useState<'MONTHLY' | 'BIWEEKLY' | 'WEEKLY'>('MONTHLY');
  const [firstDueDate, setFirstDueDate] = useState(getTodayLocalIso());
  const [draftInstallments, setDraftInstallments] = useState<DraftInstallment[]>([]);

  // Origin state
  const [originType, setOriginType] = useState<CommitmentOriginType>('CASH_TRANSFER');
  const [cashAccountId, setCashAccountId] = useState('');
  const [categoryAccountId, setCategoryAccountId] = useState('');

  // Modals
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [quickCreateAccount, setQuickCreateAccount] = useState<{
    initialName: string;
    initialType: AccountType;
    initialIsCashOrBank?: boolean;
    target: 'cash' | 'category';
  } | null>(null);

  const loadMetadata = useCallback(async () => {
    try {
      setLoading(true);
      const [cData, aData, curData] = await Promise.all([
        api.contacts.list(),
        api.accounts.summary
          ? api.accounts.summary().catch(() => api.accounts.list('ACTIVE'))
          : api.accounts.list('ACTIVE'),
        api.currencies.list(),
      ]);
      const rawAccounts: AccountOption[] = Array.isArray(aData) ? aData : aData?.accounts || [];
      setContacts(cData || []);
      setAccounts(rawAccounts);
      setCurrencies(curData || []);
    } catch (err: any) {
      setError(err.message || 'No se pudieron cargar contactos y cuentas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  const baseCurrency = useMemo(
    () => currencies.find((c) => c.isBase) || { code: 'PYG', symbol: '₲', decimalPlaces: 0 },
    [currencies],
  );
  const decimals = baseCurrency.decimalPlaces ?? 0;

  const totalAmount = useMemo(
    () => parseNumericInput(totalAmountInput, decimals),
    [totalAmountInput, decimals],
  );

  const regenerateInstallments = useCallback(
    (total: number, count: number, startIso: string, freq: 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY') => {
      const safeCount = Math.max(2, Math.min(60, count));
      const parts = splitAmountEvenly(total, safeCount, decimals);
      setDraftInstallments(
        parts.map((amt, i) => ({
          installmentNumber: i + 1,
          amount: amt > 0 ? String(amt) : '',
          dueDate: addFrequencyDate(startIso, i, freq),
          noDate: false,
        })),
      );
    },
    [decimals],
  );

  useEffect(() => {
    if (scheduleMode === 'INSTALLMENTS') {
      regenerateInstallments(totalAmount, installmentCount, firstDueDate, frequency);
    }
  }, [
    scheduleMode,
    totalAmount,
    installmentCount,
    firstDueDate,
    frequency,
    regenerateInstallments,
  ]);

  const handleDirectionChange = (nextDir: CommitmentFlowDirection) => {
    setDirection(nextDir);
    if (originType === 'CATEGORY') {
      setCategoryAccountId('');
    }
  };

  const selectedContact = contacts.find((c) => c.id === contactId);
  const selectedCash = accounts.find((a) => a.id === cashAccountId);
  const selectedCategory = accounts.find((a) => a.id === categoryAccountId);

  const installmentsSum = useMemo(() => {
    if (scheduleMode === 'SINGLE') return totalAmount;
    return draftInstallments.reduce((sum, row) => sum + parseNumericInput(row.amount, decimals), 0);
  }, [scheduleMode, draftInstallments, totalAmount, decimals]);

  const installmentsMatch =
    scheduleMode === 'SINGLE' ||
    (totalAmount > 0 && Math.abs(installmentsSum - totalAmount) < 0.001);

  const originComplete =
    originType === 'CAPITAL_ADJUSTMENT' ||
    (originType === 'CASH_TRANSFER' && Boolean(cashAccountId)) ||
    (originType === 'CATEGORY' && Boolean(categoryAccountId));

  const selectedOriginAccount = originType === 'CASH_TRANSFER' ? selectedCash : selectedCategory;

  const hasStep1 = Boolean(selectedContact) && description.trim().length > 0;
  const hasStep2 = totalAmount > 0 && installmentsMatch;
  const hasStep3 = originComplete;

  const summaryChecks = [
    {
      key: 'contact-concept',
      ok: hasStep1,
      label: !selectedContact
        ? 'Contacto: Falta seleccionar'
        : description.trim().length === 0
          ? `Contacto: ${selectedContact.name} · Falta concepto`
          : `Contacto: ${selectedContact.name}`,
    },
    {
      key: 'amount-installments',
      ok: hasStep2,
      label:
        totalAmount <= 0
          ? 'Monto y cuotas: Ingresa monto > 0'
          : !installmentsMatch
            ? 'Monto y cuotas: Las cuotas no cuadran'
            : 'Monto y cuotas',
    },
    {
      key: 'origin-account',
      ok: hasStep3,
      label:
        originType === 'CAPITAL_ADJUSTMENT'
          ? 'Cuenta: Capital'
          : selectedOriginAccount
            ? `Cuenta: ${selectedOriginAccount.name}`
            : 'Falta seleccionar cuenta',
    },
  ];

  const canSubmit = hasStep1 && hasStep2 && hasStep3 && !submitting;

  // Accounting double-entry live preview
  const previewControlLabel =
    direction === 'INFLOW' ? 'Cuentas por Cobrar (Activo)' : 'Cuentas por Pagar (Pasivo)';
  const previewCounterpartLabel =
    originType === 'CASH_TRANSFER'
      ? selectedCash?.name || 'Cuenta líquida por elegir'
      : originType === 'CATEGORY'
        ? selectedCategory?.name || 'Categoría por elegir'
        : 'Capital / Ajustes de Apertura (Patrimonio)';

  const previewDebit = direction === 'INFLOW' ? previewControlLabel : previewCounterpartLabel;
  const previewCredit = direction === 'INFLOW' ? previewCounterpartLabel : previewControlLabel;

  const isDirty = Boolean(contactId || description || totalAmountInput || notes);

  const handleCancel = () => {
    if (isDirty && !window.confirm('Tienes cambios sin guardar. ¿Deseas salir igualmente?')) {
      return;
    }
    router.push('/commitments');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      setError('Completa todos los campos requeridos y verifica el cuadre de cuotas.');
      return;
    }

    const payloadInstallments =
      scheduleMode === 'SINGLE'
        ? [
            {
              amount: totalAmount,
              dueDate: singleNoDate ? null : singleDueDate || null,
            },
          ]
        : draftInstallments.map((row) => ({
            amount: parseNumericInput(row.amount, decimals),
            dueDate: row.noDate ? null : row.dueDate || null,
          }));

    try {
      setSubmitting(true);
      setError('');
      const created = await api.commitments.create({
        contactId,
        direction,
        originType,
        description: description.trim(),
        notes: notes.trim() || null,
        totalAmount,
        accountingDate: originDate || undefined,
        cashAccountId: originType === 'CASH_TRANSFER' ? cashAccountId : null,
        categoryAccountId: originType === 'CATEGORY' ? categoryAccountId : null,
        installments: payloadInstallments,
      });
      router.push(`/commitments/${created.id}`);
    } catch (err: any) {
      setError(err.message || 'No se pudo guardar el compromiso.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header / Breadcrumb */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Link
              href="/commitments"
              className="hover:text-indigo-600 dark:hover:text-indigo-400 font-semibold flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Pagos y Cobros</span>
            </Link>
            <span>/</span>
            <span className="text-slate-700 dark:text-slate-200 font-bold">Nuevo compromiso</span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            Registrar Compromiso
          </h1>
        </div>
      </div>

      {/* Direction Segmented Tabs */}
      <div className="p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-w-xl">
        <button
          type="button"
          onClick={() => handleDirectionChange('INFLOW')}
          className={`px-4 py-3 min-h-11 rounded-xl text-xs font-extrabold transition cursor-pointer ${
            direction === 'INFLOW'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800'
          }`}
        >
          Me deben (Cuentas por cobrar)
        </button>
        <button
          type="button"
          onClick={() => handleDirectionChange('OUTFLOW')}
          className={`px-4 py-3 min-h-11 rounded-xl text-xs font-extrabold transition cursor-pointer ${
            direction === 'OUTFLOW'
              ? 'bg-rose-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800'
          }`}
        >
          Debo (Cuentas por pagar)
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="h-64 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse" />
      ) : (
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
        >
          {/* Left 70% */}
          <div className="lg:col-span-8 space-y-5">
            {/* Step 1 */}
            <section className="p-4 sm:p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-extrabold flex items-center justify-center shrink-0">
                  1
                </span>
                <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                  ¿Quién y por qué concepto?
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    {direction === 'INFLOW'
                      ? 'Persona o cliente que te debe *'
                      : 'A quién le debes *'}
                  </label>
                  <button
                    type="button"
                    onClick={() => setContactPickerOpen(true)}
                    className="w-full px-3.5 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-left flex items-center justify-between gap-2 hover:border-indigo-400 cursor-pointer"
                  >
                    <span
                      className={`text-sm truncate ${
                        selectedContact
                          ? 'font-bold text-slate-900 dark:text-slate-100'
                          : 'text-slate-400'
                      }`}
                    >
                      {selectedContact ? selectedContact.name : 'Seleccionar o crear contacto...'}
                    </span>
                    <Users className="w-4 h-4 text-indigo-600 shrink-0" />
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    Fecha del acuerdo / origen
                  </label>
                  <input
                    type="date"
                    value={originDate}
                    onChange={(e) => setOriginDate(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Concepto / descripción *
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={255}
                  placeholder="Servicio prestado, Venta de Producto, Prestamo, Compra..."
                  className="w-full px-3.5 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Notas internas (opcional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Alias bancario, referencia de factura o condiciones acordadas..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
            </section>

            {/* Step 2 */}
            <section className="p-4 sm:p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-extrabold flex items-center justify-center shrink-0">
                  2
                </span>
                <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                  Importe y plan de vencimientos
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    Monto total ({baseCurrency.code}) *
                  </label>
                  <input
                    type="text"
                    inputMode={decimals === 0 ? 'numeric' : 'decimal'}
                    value={formatAmountInput(totalAmountInput, decimals)}
                    onChange={(e) =>
                      setTotalAmountInput(normalizeAmountInput(e.target.value, decimals))
                    }
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-right text-lg font-extrabold text-slate-900 dark:text-slate-100 tabular-nums"
                  />
                </div>

                <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-2xl">
                  <button
                    type="button"
                    onClick={() => setScheduleMode('SINGLE')}
                    className={`flex-1 py-2.5 px-3 min-h-11 rounded-xl text-xs font-bold cursor-pointer transition ${
                      scheduleMode === 'SINGLE'
                        ? 'bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Pago único
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleMode('INSTALLMENTS')}
                    className={`flex-1 py-2.5 px-3 min-h-11 rounded-xl text-xs font-bold cursor-pointer transition ${
                      scheduleMode === 'INSTALLMENTS'
                        ? 'bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    En cuotas
                  </button>
                </div>
              </div>

              {scheduleMode === 'SINGLE' ? (
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setSingleNoDate(false)}
                      className={`px-3.5 py-2 min-h-11 rounded-xl border text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                        !singleNoDate
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <Calendar className="w-4 h-4" />
                      <span>Con fecha esperada</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSingleNoDate(true)}
                      className={`px-3.5 py-2 min-h-11 rounded-xl border text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                        singleNoDate
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <CalendarOff className="w-4 h-4" />
                      <span>Sin fecha definida</span>
                    </button>
                  </div>

                  {!singleNoDate ? (
                    <div className="max-w-xs">
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        Fecha esperada de {direction === 'INFLOW' ? 'cobro' : 'pago'}
                      </label>
                      <input
                        type="date"
                        value={singleDueDate}
                        onChange={(e) => setSingleDueDate(e.target.value)}
                        required
                        className="w-full px-3.5 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Se reflejará en tu Balance General desde el día 1, pero no proyectará
                      ingresos/egresos mensuales hasta que definas una fecha.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                          Cantidad de cuotas
                        </label>
                        <input
                          type="number"
                          min={2}
                          max={60}
                          value={installmentCount}
                          onChange={(e) =>
                            setInstallmentCount(
                              Math.max(2, Math.min(60, Number(e.target.value) || 2)),
                            )
                          }
                          className="w-full px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-bold text-right tabular-nums"
                        />
                        <div className="flex gap-1.5 mt-2">
                          {[2, 3, 6, 12].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setInstallmentCount(preset)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer ${
                                installmentCount === preset
                                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300'
                                  : 'border-slate-200 dark:border-slate-700 text-slate-500'
                              }`}
                            >
                              {preset}x
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                          Frecuencia
                        </label>
                        <select
                          value={frequency}
                          onChange={(e) => setFrequency(e.target.value as any)}
                          className="w-full px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                        >
                          <option value="MONTHLY">Mensual</option>
                          <option value="BIWEEKLY">Quincenal (15 días)</option>
                          <option value="WEEKLY">Semanal (7 días)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                          1.er vencimiento
                        </label>
                        <input
                          type="date"
                          value={firstDueDate}
                          onChange={(e) => setFirstDueDate(e.target.value)}
                          className="w-full px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                        />
                      </div>
                    </div>

                    {/* Cuadre banner */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-800 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-600 dark:text-slate-400">Suma de cuotas:</span>
                        <span
                          className={`font-extrabold tabular-nums ${
                            installmentsMatch ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {formatCurrency(installmentsSum, baseCurrency)}
                        </span>
                        <span className="text-slate-400">
                          / {formatCurrency(totalAmount, baseCurrency)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          regenerateInstallments(
                            totalAmount,
                            installmentCount,
                            firstDueDate,
                            frequency,
                          )
                        }
                        className="inline-flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Recalcular cuotas iguales</span>
                      </button>
                    </div>
                  </div>

                  {/* Mobile stacked installment cards (320px+) */}
                  <div className="space-y-2.5 sm:hidden">
                    {draftInstallments.map((row, idx) => (
                      <div
                        key={row.installmentNumber}
                        className="p-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 space-y-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-extrabold text-slate-800 dark:text-slate-200">
                            Cuota #{row.installmentNumber}
                          </span>
                          <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300 font-medium cursor-pointer min-h-11 px-1">
                            <input
                              type="checkbox"
                              checked={row.noDate}
                              onChange={(e) => {
                                const next = [...draftInstallments];
                                next[idx] = { ...row, noDate: e.target.checked };
                                setDraftInstallments(next);
                              }}
                            />
                            <span>Sin fecha</span>
                          </label>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          <input
                            type="date"
                            disabled={row.noDate}
                            value={row.dueDate}
                            onChange={(e) => {
                              const next = [...draftInstallments];
                              next[idx] = { ...row, dueDate: e.target.value };
                              setDraftInstallments(next);
                            }}
                            aria-label={`Fecha vencimiento cuota ${row.installmentNumber}`}
                            className="w-full px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40"
                          />
                          <input
                            type="text"
                            inputMode={decimals === 0 ? 'numeric' : 'decimal'}
                            value={formatAmountInput(row.amount, decimals)}
                            onChange={(e) => {
                              const next = [...draftInstallments];
                              next[idx] = {
                                ...row,
                                amount: normalizeAmountInput(e.target.value, decimals),
                              };
                              setDraftInstallments(next);
                            }}
                            aria-label={`Monto cuota ${row.installmentNumber}`}
                            className="w-full px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-right font-bold tabular-nums"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop editable installment schedule table */}
                  <div className="hidden sm:block overflow-x-auto rounded-2xl border border-slate-200/80 dark:border-slate-800">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200/70 dark:border-slate-800 text-slate-500">
                        <tr>
                          <th className="px-3 py-2.5 font-bold">Cuota</th>
                          <th className="px-3 py-2.5 font-bold">Fecha de vencimiento</th>
                          <th className="px-3 py-2.5 font-bold">¿Sin fecha?</th>
                          <th className="px-3 py-2.5 text-right font-bold">Monto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {draftInstallments.map((row, idx) => (
                          <tr key={row.installmentNumber}>
                            <td className="px-3 py-2 font-bold text-slate-700 dark:text-slate-300">
                              #{row.installmentNumber}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="date"
                                disabled={row.noDate}
                                value={row.dueDate}
                                onChange={(e) => {
                                  const next = [...draftInstallments];
                                  next[idx] = { ...row, dueDate: e.target.value };
                                  setDraftInstallments(next);
                                }}
                                className="px-2.5 py-1.5 min-h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={row.noDate}
                                onChange={(e) => {
                                  const next = [...draftInstallments];
                                  next[idx] = { ...row, noDate: e.target.checked };
                                  setDraftInstallments(next);
                                }}
                                aria-label={`Sin fecha cuota ${row.installmentNumber}`}
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="text"
                                inputMode={decimals === 0 ? 'numeric' : 'decimal'}
                                value={formatAmountInput(row.amount, decimals)}
                                onChange={(e) => {
                                  const next = [...draftInstallments];
                                  next[idx] = {
                                    ...row,
                                    amount: normalizeAmountInput(e.target.value, decimals),
                                  };
                                  setDraftInstallments(next);
                                }}
                                className="w-32 px-2.5 py-1.5 min-h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-right font-bold tabular-nums"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            {/* Step 3 */}
            <section className="p-4 sm:p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-extrabold flex items-center justify-center shrink-0">
                  3
                </span>
                <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                  Origen contable
                </h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setOriginType('CASH_TRANSFER')}
                  className={`p-4 rounded-2xl border text-left space-y-1.5 transition cursor-pointer ${
                    originType === 'CASH_TRANSFER'
                      ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <Wallet className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  <div className="text-xs font-extrabold text-slate-900 dark:text-slate-100">
                    {direction === 'INFLOW' ? 'Entrega de dinero' : 'Ingreso de dinero'}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {direction === 'INFLOW'
                      ? 'Prestaste dinero real desde una cuenta líquida'
                      : 'Recibiste dinero en tu Caja o Banco que debes devolver'}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setOriginType('CATEGORY')}
                  className={`p-4 rounded-2xl border text-left space-y-1.5 transition cursor-pointer ${
                    originType === 'CATEGORY'
                      ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <Tag className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <div className="text-xs font-extrabold text-slate-900 dark:text-slate-100">
                    {direction === 'INFLOW' ? 'Venta o servicio' : 'Compra o gasto acordado'}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {direction === 'INFLOW'
                      ? 'Registras un ingreso pendiente de cobro (sin mover caja hoy)'
                      : 'Registras un gasto pendiente de pago (sin mover caja hoy)'}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setOriginType('CAPITAL_ADJUSTMENT')}
                  className={`p-4 rounded-2xl border text-left space-y-1.5 transition cursor-pointer ${
                    originType === 'CAPITAL_ADJUSTMENT'
                      ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <Landmark className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  <div className="text-xs font-extrabold text-slate-900 dark:text-slate-100">
                    Saldo anterior / Ajuste
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Deuda o crédito que ya existía antes de usar ContaWave
                  </p>
                </button>
              </div>

              {originType === 'CASH_TRANSFER' && (
                <AccountPickerSheet
                  label={
                    direction === 'INFLOW'
                      ? 'Cuenta líquida de origen (Caja / Banco) *'
                      : 'Cuenta líquida donde ingresó el dinero *'
                  }
                  placeholder="Elegir Caja o Banco..."
                  accounts={accounts}
                  selectedAccountId={cashAccountId}
                  filterMode="CASH_BANK"
                  baseCurrency={baseCurrency}
                  onSelect={(acc) => setCashAccountId(acc.id)}
                  onQuickCreateAccount={(name) =>
                    setQuickCreateAccount({
                      initialName: name,
                      initialType: AccountType.ASSET,
                      initialIsCashOrBank: true,
                      target: 'cash',
                    })
                  }
                />
              )}

              {originType === 'CATEGORY' && (
                <AccountPickerSheet
                  label={direction === 'INFLOW' ? 'Categoría de Ingreso *' : 'Categoría de Gasto *'}
                  placeholder="Elegir categoría contable..."
                  accounts={accounts}
                  selectedAccountId={categoryAccountId}
                  filterMode={direction === 'INFLOW' ? 'INCOMES' : 'EXPENSES'}
                  baseCurrency={baseCurrency}
                  onSelect={(acc) => setCategoryAccountId(acc.id)}
                  onQuickCreateAccount={(name) =>
                    setQuickCreateAccount({
                      initialName: name,
                      initialType:
                        direction === 'INFLOW' ? AccountType.INCOME : AccountType.EXPENSE,
                      target: 'category',
                    })
                  }
                />
              )}

              {originType === 'CAPITAL_ADJUSTMENT' && (
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
                  Se registrará automáticamente contra tu cuenta de <strong>Capital</strong> sin
                  alterar tus saldos de Caja ni el resultado operativo del período.
                </div>
              )}
            </section>
          </div>

          {/* Right 30% Sticky Card */}
          <aside className="lg:col-span-4 lg:sticky lg:top-6 space-y-4">
            <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
              <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                Transacción vinculada
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Vista previa en vivo del asiento contable inicial en Partida Doble:
              </p>

              <div className="p-3.5 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200/70 dark:border-indigo-900/50 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-700 dark:text-slate-300 truncate">
                    <strong className="text-slate-900 dark:text-slate-100">DEBE:</strong>{' '}
                    {previewDebit}
                  </span>
                  <span className="font-extrabold tabular-nums text-slate-900 dark:text-slate-100 shrink-0">
                    {formatCurrency(totalAmount, baseCurrency)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-700 dark:text-slate-300 truncate">
                    <strong className="text-slate-900 dark:text-slate-100">HABER:</strong>{' '}
                    {previewCredit}
                  </span>
                  <span className="font-extrabold tabular-nums text-slate-900 dark:text-slate-100 shrink-0">
                    {formatCurrency(totalAmount, baseCurrency)}
                  </span>
                </div>
              </div>

              {/* Checklist (3 concise checks) */}
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                {summaryChecks.map((item) => (
                  <div key={item.key} className="flex items-center gap-2">
                    {item.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="w-4 text-center font-bold text-slate-400 dark:text-slate-500 shrink-0"
                      >
                        •
                      </span>
                    )}
                    <span
                      className={
                        item.ok
                          ? 'text-slate-800 dark:text-slate-200 font-semibold'
                          : 'text-slate-500 dark:text-slate-400'
                      }
                    >
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="w-full py-3 px-4 min-h-11 rounded-xl bg-brand-gradient text-white text-xs font-extrabold shadow-brand-glow-sm hover:opacity-95 disabled:opacity-45 cursor-pointer"
                >
                  {submitting ? 'Guardando...' : 'Guardar Compromiso'}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="w-full py-2.5 px-4 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </aside>
        </form>
      )}

      {/* Modals */}
      <ContactsModal
        isOpen={contactPickerOpen}
        onClose={() => setContactPickerOpen(false)}
        contacts={contacts}
        onUpdated={loadMetadata}
        onSelectContact={(contact) => setContactId(contact.id)}
      />

      {quickCreateAccount && (
        <AccountModal
          initialName={quickCreateAccount.initialName}
          initialType={quickCreateAccount.initialType}
          initialIsCashOrBank={quickCreateAccount.initialIsCashOrBank}
          parentCandidates={accounts as any}
          onClose={() => setQuickCreateAccount(null)}
          onSuccess={(newAccount) => {
            if (newAccount) {
              const mapped = newAccount as unknown as AccountOption;
              setAccounts((prev) =>
                prev.some((a) => a.id === mapped.id) ? prev : [...prev, mapped],
              );
              if (quickCreateAccount.target === 'cash') {
                setCashAccountId(mapped.id);
              } else {
                setCategoryAccountId(mapped.id);
              }
            }
            setQuickCreateAccount(null);
          }}
        />
      )}
    </div>
  );
}
