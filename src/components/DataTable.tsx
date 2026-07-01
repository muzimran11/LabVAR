import { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type ColumnDef,
} from '@tanstack/react-table';

interface DataTableProps<T extends object> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}

export function DataTable<T extends object>({
  data,
  columns,
  onRowClick,
  emptyMessage = 'No data',
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div>
      {/* Filter */}
      {data.length > 5 && (
        <div className="mb-3">
          <input
            type="text"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Filter..."
            className="w-full max-w-xs px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-600"
          />
        </div>
      )}

      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="bg-zinc-900 border-b border-zinc-800">
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      className={`px-3 py-2 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider ${
                        header.column.getCanSort() ? 'cursor-pointer select-none hover:text-zinc-200' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc' && (
                          <span className="text-teal-500">{'▲'}</span>
                        )}
                        {header.column.getIsSorted() === 'desc' && (
                          <span className="text-teal-500">{'▼'}</span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-3 py-8 text-center text-zinc-500 text-sm"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row, i) => (
                  <tr
                    key={row.id}
                    onClick={() => onRowClick?.(row.original)}
                    className={`border-b border-zinc-800/50 transition-colors ${
                      onRowClick ? 'cursor-pointer' : ''
                    } ${i % 2 === 0 ? 'bg-zinc-950' : 'bg-zinc-900/30'} hover:bg-zinc-800/50`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2 text-zinc-300">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {data.length > 0 && (
        <div className="mt-2 text-xs text-zinc-600">
          {table.getFilteredRowModel().rows.length} of {data.length} row{data.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

// Helper to create columns from CSV-parsed data
export function createColumnsFromKeys<T extends Record<string, unknown>>(
  keys: string[]
): ColumnDef<T, unknown>[] {
  const helper = createColumnHelper<T>();
  return keys.map((key) =>
    helper.accessor((row) => row[key], {
      id: key,
      header: key,
      cell: (info) => {
        const val = info.getValue();
        if (val === null || val === undefined) return <span className="text-zinc-600">--</span>;
        if (typeof val === 'number') return <span className="font-mono">{val}</span>;
        return String(val);
      },
    })
  );
}
