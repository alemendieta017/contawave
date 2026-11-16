'use client';

import React, { useEffect, useState } from 'react';
import { ContactDto } from '@sistema-contable/shared';
import { X, Plus, Pencil, Trash2, Check, Users, Search } from 'lucide-react';
import { api } from '../../services/api';

function getContactInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

interface ContactsModalProps {
  isOpen: boolean;
  onClose: () => void;
  contacts: ContactDto[];
  onUpdated: () => Promise<void> | void;
  onSelectContact?: (contact: ContactDto) => void;
}

export default function ContactsModal({
  isOpen,
  onClose,
  contacts,
  onUpdated,
  onSelectContact,
}: ContactsModalProps) {
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filtered = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.notes || '').toLowerCase().includes(search.toLowerCase()),
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      setError('El nombre del contacto es obligatorio.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      const created = await api.contacts.create({
        name: newName.trim(),
        notes: newNotes.trim() || null,
      });
      setNewName('');
      setNewNotes('');
      await onUpdated();
      if (onSelectContact) {
        onSelectContact(created);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'No se pudo crear el contacto.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (c: ContactDto) => {
    setEditingId(c.id);
    setEditName(c.name);
    setEditNotes(c.notes || '');
    setError('');
  };

  const handleSaveEdit = async (id: string) => {
    if (!editName.trim()) {
      setError('El nombre no puede quedar vacío.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      await api.contacts.update(id, {
        name: editName.trim(),
        notes: editNotes.trim() || null,
      });
      setEditingId(null);
      await onUpdated();
    } catch (err: any) {
      setError(err.message || 'No se pudo actualizar el contacto.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: ContactDto) => {
    try {
      setSaving(true);
      setError('');
      await api.contacts.delete(c.id);
      await onUpdated();
    } catch (err: any) {
      setError(
        err.message || 'No se pudo eliminar el contacto (puede tener compromisos asociados).',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="contacts-modal-title"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-xl max-h-dvh flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="contacts-modal-title"
                className="text-base font-bold text-slate-900 dark:text-slate-100"
              >
                {onSelectContact ? 'Seleccionar o crear contacto' : 'Agenda de Contactos'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Personas, clientes o proveedores vinculados a tus compromisos
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal de contactos"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 min-h-11 min-w-11 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 font-medium">
              {error}
            </div>
          )}

          {/* Create contact form */}
          <form
            onSubmit={handleCreate}
            className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-3"
          >
            <div className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Plus className="w-4 h-4 text-indigo-600" />
              <span>Agregar nuevo contacto</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                placeholder="Nombre completo o empresa *"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-3.5 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
              <input
                type="text"
                placeholder="Nota, teléfono o alias (opcional)"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                className="w-full px-3.5 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 min-h-11 rounded-xl bg-brand-gradient text-white text-xs font-bold shadow-brand-glow-sm hover:opacity-95 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>{onSelectContact ? 'Crear y seleccionar' : 'Guardar contacto'}</span>
              </button>
            </div>
          </form>

          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar contacto por nombre o nota..."
              className="w-full pl-10 pr-3.5 py-2.5 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
          </div>

          {/* Contact list */}
          <div className="space-y-2">
            {filtered.length === 0 ? (
              <p className="text-center text-xs text-slate-500 dark:text-slate-400 py-6">
                No se encontraron contactos.
              </p>
            ) : (
              filtered.map((contact) => {
                const isEditing = editingId === contact.id;
                return (
                  <div
                    key={contact.id}
                    className="p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    {isEditing ? (
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
                        />
                        <input
                          type="text"
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          placeholder="Notas"
                          className="px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    ) : (
                      <div
                        className={`flex-1 min-w-0 text-left flex items-center gap-3 ${onSelectContact ? 'cursor-pointer' : ''}`}
                        onClick={() => {
                          if (onSelectContact) {
                            onSelectContact(contact);
                            onClose();
                          }
                        }}
                      >
                        <div
                          aria-hidden="true"
                          className="w-9 h-9 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold text-xs flex items-center justify-center shrink-0"
                        >
                          {getContactInitials(contact.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                            {contact.name}
                          </div>
                          {contact.notes && (
                            <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                              {contact.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(contact.id)}
                            disabled={saving}
                            className="px-3 py-2 min-h-11 rounded-xl bg-emerald-600 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Check className="w-4 h-4" />
                            <span>Guardar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-3 py-2 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          {onSelectContact && (
                            <button
                              type="button"
                              onClick={() => {
                                onSelectContact(contact);
                                onClose();
                              }}
                              className="px-3 py-2 min-h-11 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold hover:bg-indigo-100 cursor-pointer"
                            >
                              Elegir
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => startEdit(contact)}
                            aria-label={`Editar ${contact.name}`}
                            className="p-2.5 min-h-11 min-w-11 rounded-xl text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center cursor-pointer"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(contact)}
                            disabled={saving}
                            aria-label={`Eliminar ${contact.name}`}
                            className="p-2.5 min-h-11 min-w-11 rounded-xl text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
