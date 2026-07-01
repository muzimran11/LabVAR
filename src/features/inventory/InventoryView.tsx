import { useEffect, useState, useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import {
  createStock,
  updateStock,
  createCulture,
  checkCulture,
} from '@/lib/invoke';
import { Modal } from '@/components/Modal';
import { DataTable } from '@/components/DataTable';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import type { Stock, Culture } from '@/store/useAppStore';

// ------- Stock Status -------

function stockStatus(stock: Stock): 'ok' | 'low' | 'out' {
  if (stock.qty <= stock.reorder_at) return 'out';
  if (stock.qty <= stock.reorder_at * 1.5) return 'low';
  return 'ok';
}

function StatusBadge({ status }: { status: 'ok' | 'low' | 'out' | 'overdue' | 'due' }) {
  const styles: Record<string, string> = {
    ok: 'bg-emerald-900/40 text-emerald-400 border-emerald-800',
    low: 'bg-amber-900/40 text-amber-400 border-amber-800',
    out: 'bg-red-900/40 text-red-400 border-red-800',
    overdue: 'bg-red-900/40 text-red-400 border-red-800',
    due: 'bg-amber-900/40 text-amber-400 border-amber-800',
  };
  const labels: Record<string, string> = {
    ok: 'OK',
    low: 'Low',
    out: 'Reorder',
    overdue: 'Overdue',
    due: 'Due Today',
  };

  return (
    <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

// ------- Culture Status -------

function cultureStatus(culture: Culture): 'ok' | 'due' | 'overdue' {
  if (!culture.next_due) return 'ok';
  const due = new Date(culture.next_due);
  const now = new Date();
  if (due <= now) return 'overdue';
  if (due.toDateString() === now.toDateString()) return 'due';
  return 'ok';
}

// ------- Main Component -------

export function InventoryView() {
  const stocks = useAppStore((s) => s.stocks);
  const cultures = useAppStore((s) => s.cultures);
  const loadStocks = useAppStore((s) => s.loadStocks);
  const loadCultures = useAppStore((s) => s.loadCultures);
  const modalOpen = useAppStore((s) => s.modalOpen);
  const setModalOpen = useAppStore((s) => s.setModalOpen);

  const [editingStock, setEditingStock] = useState<Stock | null>(null);
  const [checkingCulture, setCheckingCulture] = useState<Culture | null>(null);

  useEffect(() => {
    loadStocks();
    loadCultures();
  }, [loadStocks, loadCultures]);

  // ------- Stock Columns -------
  const stockColumns = useMemo<ColumnDef<Stock, unknown>[]>(() => {
    const helper = createColumnHelper<Stock>();
    return [
      helper.accessor('name', {
        header: 'Name',
        cell: (info) => <span className="font-medium">{info.getValue()}</span>,
      }),
      helper.accessor('qty', {
        header: 'Quantity',
        cell: (info) => {
          const stock = info.row.original;
          return <span className="font-mono">{info.getValue()} {stock.unit}</span>;
        },
      }),
      helper.accessor('reorder_at', {
        header: 'Reorder At',
        cell: (info) => {
          const stock = info.row.original;
          return <span className="font-mono text-zinc-500">{info.getValue()} {stock.unit}</span>;
        },
      }),
      helper.display({
        id: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={stockStatus(row.original)} />,
      }),
    ] as ColumnDef<Stock, unknown>[];
  }, []);

  // ------- Culture Columns -------
  const cultureColumns = useMemo<ColumnDef<Culture, unknown>[]>(() => {
    const helper = createColumnHelper<Culture>();
    return [
      helper.accessor('name', {
        header: 'Name',
        cell: (info) => <span className="font-medium">{info.getValue()}</span>,
      }),
      helper.accessor('kind', {
        header: 'Type',
        cell: (info) => <span className="text-zinc-400">{info.getValue()}</span>,
      }),
      helper.accessor('interval_days', {
        header: 'Interval',
        cell: (info) => {
          const days = info.getValue() as number;
          return <span className="font-mono">{days}d</span>;
        },
      }),
      helper.accessor('last_checked_ts', {
        header: 'Last Checked',
        cell: (info) => {
          const val = info.getValue() as string | null;
          if (!val) return <span className="text-zinc-600">Never</span>;
          return (
            <span className="font-mono text-xs">
              {new Date(val).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            </span>
          );
        },
      }),
      helper.accessor('next_due', {
        header: 'Next Due',
        cell: (info) => {
          const val = info.getValue() as string | null;
          if (!val) return <span className="text-zinc-600">--</span>;
          return (
            <span className="font-mono text-xs">
              {new Date(val).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            </span>
          );
        },
      }),
      helper.display({
        id: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={cultureStatus(row.original)} />,
      }),
      helper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCheckingCulture(row.original);
            }}
            className="text-xs text-teal-500 hover:text-teal-400 transition-colors font-medium"
          >
            Log Check
          </button>
        ),
      }),
    ] as ColumnDef<Culture, unknown>[];
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100 mb-1">Inventory</h1>
        <p className="text-sm text-zinc-500">Track reagent stocks and cell culture maintenance</p>
      </div>

      {/* Stocks Section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Reagent Stocks</h2>
          <button
            onClick={() => setModalOpen('addStock')}
            className="px-3 py-1.5 text-sm bg-teal-600 hover:bg-teal-500 text-white rounded transition-colors font-medium"
          >
            + Add Stock
          </button>
        </div>
        <DataTable
          data={stocks}
          columns={stockColumns}
          onRowClick={(stock) => setEditingStock(stock)}
          emptyMessage="No stock items. Add reagents and consumables to track."
        />
      </section>

      {/* Cultures Section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Cell / Culture Maintenance</h2>
          <button
            onClick={() => setModalOpen('addCulture')}
            className="px-3 py-1.5 text-sm bg-teal-600 hover:bg-teal-500 text-white rounded transition-colors font-medium"
          >
            + Add Culture
          </button>
        </div>
        <DataTable
          data={cultures}
          columns={cultureColumns}
          emptyMessage="No cultures tracked. Add cell lines or cultures to monitor."
        />
      </section>

      {/* Add Stock Modal */}
      {modalOpen === 'addStock' && (
        <Modal title="Add Stock Item" onClose={() => setModalOpen(null)}>
          <AddStockForm onClose={() => setModalOpen(null)} />
        </Modal>
      )}

      {/* Edit Stock Modal */}
      {editingStock && (
        <Modal title={`Edit: ${editingStock.name}`} onClose={() => setEditingStock(null)}>
          <EditStockForm stock={editingStock} onClose={() => setEditingStock(null)} />
        </Modal>
      )}

      {/* Add Culture Modal */}
      {modalOpen === 'addCulture' && (
        <Modal title="Add Culture" onClose={() => setModalOpen(null)}>
          <AddCultureForm onClose={() => setModalOpen(null)} />
        </Modal>
      )}

      {/* Log Culture Check Modal */}
      {checkingCulture && (
        <Modal title={`Log Check: ${checkingCulture.name}`} onClose={() => setCheckingCulture(null)}>
          <LogCultureCheckForm culture={checkingCulture} onClose={() => setCheckingCulture(null)} />
        </Modal>
      )}
    </div>
  );
}

// ------- Add Stock Form -------

function AddStockForm({ onClose }: { onClose: () => void }) {
  const loadStocks = useAppStore((s) => s.loadStocks);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [reorderAt, setReorderAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !quantity || !unit.trim()) {
      setError('Name, quantity, and unit are required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await createStock(name.trim(), Number(quantity), unit.trim(), Number(reorderAt) || 0);
      await loadStocks();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add stock');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <FormField label="Name" required>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., DMEM" className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600" autoFocus />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Quantity" required>
          <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600" step="any" />
        </FormField>
        <FormField label="Unit" required>
          <input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="mL, bottles, etc." className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600" />
        </FormField>
      </div>
      <FormField label="Reorder At">
        <input type="number" value={reorderAt} onChange={(e) => setReorderAt(e.target.value)} placeholder="0" className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600" step="any" />
      </FormField>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
        <button type="submit" disabled={submitting} className="px-4 py-2 text-sm bg-teal-600 hover:bg-teal-500 disabled:bg-teal-800 text-white rounded transition-colors font-medium">
          {submitting ? 'Adding...' : 'Add Stock'}
        </button>
      </div>
    </form>
  );
}

// ------- Edit Stock Form -------

function EditStockForm({ stock, onClose }: { stock: Stock; onClose: () => void }) {
  const loadStocks = useAppStore((s) => s.loadStocks);
  const [quantity, setQuantity] = useState(String(stock.qty));
  const [reorderAt, setReorderAt] = useState(String(stock.reorder_at));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await updateStock(stock.id, Number(quantity), Number(reorderAt));
      await loadStocks();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update stock');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="text-sm text-zinc-400 mb-2">
        {stock.name} &middot; {stock.unit}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Quantity">
          <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600" step="any" autoFocus />
        </FormField>
        <FormField label="Reorder At">
          <input type="number" value={reorderAt} onChange={(e) => setReorderAt(e.target.value)} className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600" step="any" />
        </FormField>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
        <button type="submit" disabled={submitting} className="px-4 py-2 text-sm bg-teal-600 hover:bg-teal-500 disabled:bg-teal-800 text-white rounded transition-colors font-medium">
          {submitting ? 'Updating...' : 'Update Stock'}
        </button>
      </div>
    </form>
  );
}

// ------- Add Culture Form -------

function AddCultureForm({ onClose }: { onClose: () => void }) {
  const loadCultures = useAppStore((s) => s.loadCultures);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [intervalDays, setIntervalDays] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !kind.trim()) {
      setError('Name and type are required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await createCulture(name.trim(), kind.trim(), Number(intervalDays));
      await loadCultures();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add culture');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <FormField label="Name" required>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., HeLa P12" className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600" autoFocus />
      </FormField>
      <FormField label="Type" required>
        <input type="text" value={kind} onChange={(e) => setKind(e.target.value)} placeholder="e.g., Adherent, Suspension" className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600" />
      </FormField>
      <FormField label="Check Interval (days)">
        <input type="number" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} placeholder="1" className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600" min="1" />
      </FormField>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
        <button type="submit" disabled={submitting} className="px-4 py-2 text-sm bg-teal-600 hover:bg-teal-500 disabled:bg-teal-800 text-white rounded transition-colors font-medium">
          {submitting ? 'Adding...' : 'Add Culture'}
        </button>
      </div>
    </form>
  );
}

// ------- Log Culture Check Form -------

function LogCultureCheckForm({ culture, onClose }: { culture: Culture; onClose: () => void }) {
  const loadCultures = useAppStore((s) => s.loadCultures);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await checkCulture(culture.id);
      await loadCultures();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log check');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="text-sm text-zinc-400 mb-2">
        {culture.name} &middot; {culture.kind}
      </div>
      <p className="text-xs text-zinc-500">This will record the current time as the last check for this culture.</p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
        <button type="submit" disabled={submitting} className="px-4 py-2 text-sm bg-teal-600 hover:bg-teal-500 disabled:bg-teal-800 text-white rounded transition-colors font-medium">
          {submitting ? 'Logging...' : 'Log Check'}
        </button>
      </div>
    </form>
  );
}

// ------- Shared Form Field -------

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
