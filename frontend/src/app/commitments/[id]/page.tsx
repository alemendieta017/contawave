'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { CommitmentDto, CommitmentInstallmentDto, ContactDto } from '@sistema-contable/shared';
import {
  ArrowLeft,
  Banknote,
  Calendar,
  ShieldAlert,
  Plus,
  Trash2,
  Pencil,
  Check,
  Undo2,
  FileText,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { api } from '../../../services/api';
import { formatCurrency } from '../../../lib/utils';
import { KpiCard } from '../../../components/ui/KpiCard';
import {
  formatAmountInput,
  formatCommitmentDate,
  getOriginSummaryLabel,
  getStatusMeta,
  getTodayLocalIso,
  normalizeAmountInput,
  parseNumericInput,
} from '../../../components/commitments/commitment-ui';
import SettleInstallmentModal from '../../../components/commitments/SettleInstallmentModal';
import RescheduleInstallmentModal from '../../../components/commitments/RescheduleInstallmentModal';
import ForgiveInstallmentModal from '../../../components/commitments/ForgiveInstallmentModal';
import type { AccountOption } from '../../../types/account';

export default function CommitmentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [commitment, setCommitment] = useState<CommitmentDto | null>(null);
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Metadata edit state
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaContactId, setMetaContactId] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [metaNotes, setMetaNotes] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);

  // Add installment inline state
  const [showAddInst, setShowAddInst] = useState(false);
  const [newInstAmount, setNewInstAmount] = useState('');
  const [newInstDueDate, setNewInstDueDate] = useState(getTodayLocalIso());
  const [newInstNoDate, setNewInstNoDate] = useState(false);
  const [addingInst, setAddingInst] = useState(false);

  // Modals
  const [settleTarget, setSettleTarget] = useState<CommitmentInstallmentDto | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<CommitmentInstallmentDto | null>(null);
  const [forgiveTarget, setForgiveTarget] = useState<CommitmentInstallmentDto | null>(null);

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError('');
      const [cData, contactsData, accData, curData] = await Promise.all([
        api.commitments.get(id),
        api.contacts.list(),
        api.accounts.list(),
        api.currencies.list(),
      ]);
      setCommitment(cData);
      setMetaContactId(cData.contactId);
      setMetaDescription(cData.description);
      setMetaNotes(cData.notes || '');
      setContacts(contactsData || []);
      setAccounts(accData || []);
      setCurrencies(curData || []);
    } catch (err: any) {
      setError(err.message || 'No se pudo cargar el compromiso.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const baseCurrency = useMemo(
    () => currencies.find((c) => c.isBase) || { code: 'PYG', symbol: '₲', decimalPlaces: 0 },
    [currencies],
  );
  const decimals = baseCurrency.decimalPlaces ?? 0;

  const handleSaveMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitment || !metaDescription.trim()) return;
    try {
      setSavingMeta(true);
      setError('');
      const updated = await api.commitments.update(commitment.id, {
        contactId: metaContactId,
        description: metaDescription.trim(),
        notes: metaNotes.trim() || null,
      });
      setCommitment(updated);
      setEditingMeta(false);
    } catch (err: any) {
      setError(err.message || 'No se pudieron guardar los datos.');
    } finally {
      setSavingMeta(false);
    }
  };

  const handleAddInstallment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitment) return;
    const amt = parseNumericInput(newInstAmount, decimals);
    if (amt <= 0) {
      setError('El monto de la nueva cuota debe ser mayor a 0.');
      return;
    }
    try {
      setAddingInst(true);
      setError('');
      const updated = await api.commitments.addInstallment(commitment.id, {
        amount: amt,
        dueDate: newInstNoDate ? null : newInstDueDate || null,
      });
      setCommitment(updated);
      setNewInstAmount('');
      setShowAddInst(false);
    } catch (err: any) {
      setError(err.message || 'No se pudo agregar la cuota.');
    } finally {
      setAddingInst(false);
    }
  };

  const handleDeleteInstallment = async (inst: CommitmentInstallmentDto) => {
    if (!commitment) return;
    if (
      !window.confirm(
        `¿Eliminar la cuota #${inst.installmentNumber}? Esto ajustará el total del compromiso y su asiento contable.`,
      )
    ) {
      return;
    }
    try {
      setError('');
      const updated = await api.commitments.deleteInstallment(commitment.id, inst.id);
      setCommitment(updated);
    } catch (err: any) {
      setError(err.message || 'No se pudo eliminar la cuota.');
    }
  };

  const handleUndoSettlement = async (settlementId: string) => {
    if (
      !window.confirm(
        '¿Deshacer este movimiento? Se generará un contra-asiento contable en el Libro Diario y el saldo volverá a quedar pendiente.',
      )
    ) {
      return;
    }
    try {
      setError('');
      const updated = await api.commitments.undoSettlement(settlementId);
      setCommitment(updated);
    } catch (err: any) {
      setError(err.message || 'No se pudo deshacer el movimiento.');
    }
  };

  const handleDeleteCommitment = async () => {
    if (!commitment) return;
    if (
      !window.confirm(
        '¿Eliminar este compromiso permanentemente junto con su asiento contable inicial?',
      )
    ) {
      return;
    }
    try {
      await api.commitments.delete(commitment.id);
      router.push('/commitments');
    } catch (err: any) {
      setError(err.message || 'No se pudo eliminar el compromiso.');
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 max-w-6xl mx-auto">
        <div className="h-24 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse" />
        <div className="h-64 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse" />
      </div>
    );
  }

  if (!commitment) {
    return (
      <div className="max-w-3xl mx-auto p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3">
        <p className="text-sm font-bold text-rose-600">{error || 'Compromiso no encontrado.'}</p>
        <Link
          href="/commitments"
          className="inline-flex items-center gap-2 px-4 py-2.5 min-h-11 rounded-xl bg-indigo-600 text-white text-xs font-bold"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Volver a Pagos y Cobros</span>
        </Link>
      </div>
    );
  }

  const isInflow = commitment.direction === 'INFLOW';
  const statusMeta = getStatusMeta(commitment.status);
  const pct =
    commitment.totalAmount > 0
      ? Math.min(100, Math.round((commitment.settledAmount / commitment.totalAmount) * 100))
      : 0;

  const allSettlements = commitment.installments
    .flatMap((inst) =>
      inst.settlements.map((s) => ({
        ...s,
        installmentNumber: inst.installmentNumber,
      })),
    )
    .sort((a, b) => b.settledAt.localeCompare(a.settledAt));

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/commitments"
            className="inline-flex items-center gap-2 px-3.5 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400 shadow-xs transition"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
            <span>Volver a Pagos y Cobros</span>
          </Link>

          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 min-w-0">
            <Link href="/commitments" className="hover:text-indigo-600 font-semibold shrink-0">
              Pagos y Cobros
            </Link>
            <span>/</span>
            <span className="truncate font-bold text-slate-700 dark:text-slate-200">
              {commitment.description}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-slate-100">
            {commitment.description}
          </h1>
          <span
            className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
              isInflow
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
            }`}
          >
            {isInflow ? 'Cuentas por cobrar' : 'Cuentas por pagar'}
          </span>
          <span
            className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${statusMeta.badgeClass}`}
          >
            {statusMeta.label}
          </span>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 3 Detail KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
        <KpiCard
          label="Total del compromiso"
          value={formatCurrency(commitment.totalAmount, baseCurrency)}
          footer={
            <div className="text-xs text-muted-foreground">{getOriginSummaryLabel(commitment)}</div>
          }
        />

        <KpiCard
          label={isInflow ? 'Ya cobrado / liquidado' : 'Ya pagado / liquidado'}
          value={formatCurrency(commitment.settledAmount, baseCurrency)}
          valueClassName="text-emerald-600 dark:text-emerald-400"
          badge={<span className="text-xs font-bold text-indigo-600 tabular-nums">{pct}%</span>}
          footer={
            <div className="h-2 rounded-full bg-muted overflow-hidden mt-1">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
            </div>
          }
        />

        <KpiCard
          label="Saldo pendiente"
          value={formatCurrency(commitment.pendingAmount, baseCurrency)}
          footer={
            <div className="text-xs text-muted-foreground">
              {commitment.installments.filter((i) => i.pendingAmount > 0).length} cuota(s)
              abierta(s)
            </div>
          }
        />
      </div>

      {/* 70/30 Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 70%: Plan de pagos + Movimientos */}
        <div className="lg:col-span-8 space-y-6">
          {/* Installment plan */}
          <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                Plan de pagos ({commitment.installments.length})
              </h2>
              <button
                type="button"
                onClick={() => setShowAddInst((v) => !v)}
                className="px-3.5 py-2 min-h-11 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold flex items-center gap-1.5 hover:bg-indigo-100 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Agregar cuota</span>
              </button>
            </div>

            {showAddInst && (
              <form
                onSubmit={handleAddInstallment}
                className="p-4 bg-indigo-50/40 dark:bg-indigo-950/20 border-b border-indigo-200/60 dark:border-indigo-900/50 space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Monto
                    </label>
                    <input
                      type="text"
                      inputMode={decimals === 0 ? 'numeric' : 'decimal'}
                      value={formatAmountInput(newInstAmount, decimals)}
                      onChange={(e) =>
                        setNewInstAmount(normalizeAmountInput(e.target.value, decimals))
                      }
                      placeholder="0"
                      className="w-full px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-right font-bold tabular-nums text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Vencimiento
                    </label>
                    <input
                      type="date"
                      disabled={newInstNoDate}
                      value={newInstDueDate}
                      onChange={(e) => setNewInstDueDate(e.target.value)}
                      className="w-full px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm disabled:opacity-40"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={addingInst}
                      className="flex-1 py-2.5 px-4 min-h-11 rounded-xl bg-brand-gradient text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      {addingInst ? 'Guardando...' : 'Agregar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAddInst(false)}
                      className="py-2.5 px-3 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
                    >
                      Cerrar
                    </button>
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newInstNoDate}
                    onChange={(e) => setNewInstNoDate(e.target.checked)}
                  />
                  <span>Dejar esta nueva cuota sin fecha definida</span>
                </label>
              </form>
            )}

            {/* Mobile cards for installments (320px+) */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
              {commitment.installments.map((inst) => {
                const instMeta = getStatusMeta(inst.status);
                const canDeleteInst =
                  inst.settledAmount <= 0.0001 && commitment.installments.length > 1;
                return (
                  <div key={inst.id} className="p-4 space-y-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-slate-900 dark:text-slate-100">
                          Cuota #{inst.installmentNumber}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-bold border ${instMeta.badgeClass}`}
                        >
                          {instMeta.label}
                        </span>
                      </div>
                      <span className="text-slate-500 dark:text-slate-400">
                        {formatCommitmentDate(inst.dueDate)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-slate-500 dark:text-slate-400 block">Total</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                          {formatCurrency(inst.amount, baseCurrency)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-500 dark:text-slate-400 block">Pendiente</span>
                        <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
                          {formatCurrency(inst.pendingAmount, baseCurrency)}
                        </span>
                      </div>
                    </div>

                    {inst.pendingAmount > 0 ? (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setSettleTarget(inst)}
                          className="flex-1 px-3 py-2 min-h-11 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <Banknote className="w-3.5 h-3.5" />
                          <span>{isInflow ? 'Cobrar' : 'Pagar'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setRescheduleTarget(inst)}
                          aria-label={`Reprogramar cuota ${inst.installmentNumber}`}
                          className="p-2.5 min-h-11 min-w-11 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center cursor-pointer"
                        >
                          <Calendar className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setForgiveTarget(inst)}
                          aria-label={`Condonar cuota ${inst.installmentNumber}`}
                          className="p-2.5 min-h-11 min-w-11 rounded-xl border border-amber-200 dark:border-amber-800 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 flex items-center justify-center cursor-pointer"
                        >
                          <ShieldAlert className="w-4 h-4" />
                        </button>
                        {canDeleteInst && (
                          <button
                            type="button"
                            onClick={() => handleDeleteInstallment(inst)}
                            aria-label={`Eliminar cuota ${inst.installmentNumber}`}
                            className="p-2.5 min-h-11 min-w-11 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between pt-1">
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Saldada
                        </span>
                        {canDeleteInst && (
                          <button
                            type="button"
                            onClick={() => handleDeleteInstallment(inst)}
                            aria-label={`Eliminar cuota ${inst.installmentNumber}`}
                            className="p-2 min-h-11 min-w-11 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200/70 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-bold">Cuota</th>
                    <th className="px-4 py-3 font-bold">Vencimiento</th>
                    <th className="px-4 py-3 font-bold">Estado</th>
                    <th className="px-4 py-3 text-right font-bold">Total</th>
                    <th className="px-4 py-3 text-right font-bold">Pendiente</th>
                    <th className="px-4 py-3 text-right font-bold">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {commitment.installments.map((inst) => {
                    const instMeta = getStatusMeta(inst.status);
                    const canDeleteInst =
                      inst.settledAmount <= 0.0001 && commitment.installments.length > 1;
                    return (
                      <tr key={inst.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 font-extrabold text-slate-900 dark:text-slate-100">
                          #{inst.installmentNumber}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {formatCommitmentDate(inst.dueDate)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-bold border ${instMeta.badgeClass}`}
                          >
                            {instMeta.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {formatCurrency(inst.amount, baseCurrency)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {formatCurrency(inst.pendingAmount, baseCurrency)}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {inst.pendingAmount > 0 ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setSettleTarget(inst)}
                                  className="px-3 py-1.5 min-h-9 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 cursor-pointer flex items-center gap-1"
                                >
                                  <Banknote className="w-3.5 h-3.5" />
                                  <span>{isInflow ? 'Cobrar' : 'Pagar'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRescheduleTarget(inst)}
                                  title="Reprogramar / cambiar fecha"
                                  className="p-2 min-h-9 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white cursor-pointer"
                                >
                                  <Calendar className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setForgiveTarget(inst)}
                                  title="Condonar saldo"
                                  className="p-2 min-h-9 rounded-lg border border-amber-200 dark:border-amber-800 text-amber-600 hover:bg-amber-50 cursor-pointer"
                                >
                                  <ShieldAlert className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold px-2">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Saldada
                              </span>
                            )}
                            {canDeleteInst && (
                              <button
                                type="button"
                                onClick={() => handleDeleteInstallment(inst)}
                                title="Eliminar cuota"
                                className="p-2 min-h-9 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Settlements History */}
          <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                Movimientos registrados ({allSettlements.length})
              </h2>
            </div>

            {allSettlements.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                Aún no se registraron cobros, pagos ni condonaciones.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {allSettlements.map((s) => (
                  <div
                    key={s.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {s.settlementType === 'FORGIVEN'
                            ? 'Condonación / Incobrable'
                            : isInflow
                              ? 'Cobro en efectivo / banco'
                              : 'Pago en efectivo / banco'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
                          Cuota #{s.installmentNumber}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Fecha: {formatCommitmentDate(s.settledAt)}
                        {s.cashAccountName ? ` · Cuenta: ${s.cashAccountName}` : ''}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-center">
                      <span className="text-sm font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
                        {formatCurrency(s.amount, baseCurrency)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUndoSettlement(s.id)}
                        className="px-3 py-1.5 min-h-9 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 flex items-center gap-1 cursor-pointer"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        <span>Deshacer</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right 30%: Datos + Transacción vinculada + Delete */}
        <aside className="lg:col-span-4 space-y-5">
          <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                Datos del compromiso
              </h2>
              {!editingMeta && (
                <button
                  type="button"
                  onClick={() => {
                    setMetaDescription(commitment.description);
                    setMetaContactId(commitment.contactId);
                    setMetaNotes(commitment.notes || '');
                    setEditingMeta(true);
                  }}
                  className="px-3 py-1.5 min-h-9 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Editar</span>
                </button>
              )}
            </div>

            {editingMeta ? (
              <form onSubmit={handleSaveMeta} className="space-y-3 text-xs">
                <div>
                  <label
                    htmlFor="edit-meta-name"
                    className="block font-bold text-slate-600 dark:text-slate-400 mb-1"
                  >
                    Nombre
                  </label>
                  <input
                    id="edit-meta-name"
                    type="text"
                    value={metaDescription}
                    onChange={(e) => setMetaDescription(e.target.value)}
                    required
                    className="w-full px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="edit-meta-contact"
                    className="block font-bold text-slate-600 dark:text-slate-400 mb-1"
                  >
                    Contacto
                  </label>
                  <select
                    id="edit-meta-contact"
                    value={metaContactId}
                    onChange={(e) => setMetaContactId(e.target.value)}
                    className="w-full px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="edit-meta-notes"
                    className="block font-bold text-slate-600 dark:text-slate-400 mb-1"
                  >
                    Notas
                  </label>
                  <textarea
                    id="edit-meta-notes"
                    value={metaNotes}
                    onChange={(e) => setMetaNotes(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingMeta(false)}
                    className="px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 font-bold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingMeta}
                    className="px-4 py-2 min-h-11 rounded-xl bg-brand-gradient text-white font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>Guardar</span>
                  </button>
                </div>
              </form>
            ) : (
              <dl className="space-y-3 text-xs">
                <div>
                  <dt className="text-slate-500">Contacto</dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                    {commitment.contactName}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Fecha de origen</dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                    {formatCommitmentDate(
                      commitment.initialTransaction?.accountingDate ||
                        commitment.createdAt.slice(0, 10),
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Origen contable</dt>
                  <dd className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                    {getOriginSummaryLabel(commitment)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Notas</dt>
                  <dd className="text-slate-700 dark:text-slate-300 mt-0.5">
                    {commitment.notes || 'Sin notas adicionales.'}
                  </dd>
                </div>
              </dl>
            )}
          </div>

          {/* Linked Initial Transaction */}
          {commitment.initialTransaction && (
            <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-slate-100">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  <span>Transacción vinculada</span>
                </div>
                <Link
                  href="/transactions"
                  className="text-xs font-bold text-indigo-600 hover:underline"
                >
                  Libro Diario
                </Link>
              </div>
              <div className="text-xs text-slate-500">
                Fecha contable: {formatCommitmentDate(commitment.initialTransaction.accountingDate)}
              </div>
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800 space-y-1.5 text-xs">
                {commitment.initialTransaction.entries.map((entry, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-2">
                    <span className="text-slate-700 dark:text-slate-300 truncate">
                      <strong>{entry.entryType === 'DEBIT' ? 'DEBE' : 'HABER'}:</strong>{' '}
                      {entry.accountName}
                    </span>
                    <span className="font-bold tabular-nums shrink-0 text-slate-900 dark:text-slate-100">
                      {formatCurrency(entry.amount, baseCurrency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Delete commitment card */}
          <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-rose-200/70 dark:border-rose-900/50 shadow-xs space-y-3">
            <h2 className="text-sm font-extrabold text-rose-700 dark:text-rose-400">
              Eliminar compromiso
            </h2>
            {commitment.settledAmount > 0.0001 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No es posible eliminar un compromiso que ya posee movimientos registrados. Deshaz
                primero los cobros o pagos registrados.
              </p>
            ) : (
              <>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Al no tener cobros ni pagos registrados, puedes eliminarlo junto con su asiento
                  inicial.
                </p>
                <button
                  type="button"
                  onClick={handleDeleteCommitment}
                  className="w-full py-2.5 px-4 min-h-11 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Eliminar compromiso</span>
                </button>
              </>
            )}
          </div>
        </aside>
      </div>

      {/* Modals */}
      {settleTarget && (
        <SettleInstallmentModal
          isOpen={true}
          onClose={() => setSettleTarget(null)}
          commitment={commitment}
          installment={settleTarget}
          cashAccounts={accounts}
          baseCurrency={baseCurrency}
          onSuccess={(updated) => setCommitment(updated)}
        />
      )}

      {rescheduleTarget && (
        <RescheduleInstallmentModal
          isOpen={true}
          onClose={() => setRescheduleTarget(null)}
          commitment={commitment}
          installment={rescheduleTarget}
          baseCurrency={baseCurrency}
          onSuccess={(updated) => setCommitment(updated)}
        />
      )}

      {forgiveTarget && (
        <ForgiveInstallmentModal
          isOpen={true}
          onClose={() => setForgiveTarget(null)}
          commitment={commitment}
          installment={forgiveTarget}
          accounts={accounts}
          baseCurrency={baseCurrency}
          onSuccess={(updated) => setCommitment(updated)}
        />
      )}
    </div>
  );
}
