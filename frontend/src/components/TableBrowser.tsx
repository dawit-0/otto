import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type FilterRule, type FilterOp, type Column } from '../api';
import DataTable from './DataTable';
import ColumnProfilePanel from './ColumnProfilePanel';

interface Props {
  dbId: string;
  tableName: string;
  columnDefs: Column[];
}

interface SortState {
  column: string;
  direction: 'asc' | 'desc';
}

const OP_LABELS: Record<FilterOp, string> = {
  contains: 'contains',
  equals: '=',
  not_equals: '≠',
  starts_with: 'starts with',
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
  is_null: 'is null',
  is_not_null: 'is not null',
};

const VALUE_OPS: FilterOp[] = ['contains', 'equals', 'not_equals', 'starts_with', 'gt', 'lt', 'gte', 'lte'];

const LIMIT = 100;

export default function TableBrowser({ dbId, tableName, columnDefs }: Props) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<SortState | null>(null);
  const [filters, setFilters] = useState<FilterRule[]>([]);

  const [showAddFilter, setShowAddFilter] = useState(false);
  const [newCol, setNewCol] = useState('');
  const [newOp, setNewOp] = useState<FilterOp>('contains');
  const [newVal, setNewVal] = useState('');

  const [showProfile, setShowProfile] = useState(false);

  const addFilterRef = useRef<HTMLDivElement>(null);

  const colNames = columnDefs.map((c) => c.name);

  const loadData = useCallback(async (nextOffset: number, currentSort: SortState | null, currentFilters: FilterRule[]) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getTableData(
        dbId,
        tableName,
        LIMIT,
        nextOffset,
        currentSort?.column,
        currentSort?.direction,
        currentFilters,
      );
      setColumns(result.columns);
      setRows(result.rows);
      setTotal(result.total);
      setOffset(nextOffset);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [dbId, tableName]);

  // Reload from page 1 whenever sort or filters change
  useEffect(() => {
    loadData(0, sort, filters);
  }, [dbId, tableName, sort, filters, loadData]);

  const pkColumns = columnDefs.filter((c) => c.pk).map((c) => c.name);

  const handleCellEdit = useCallback(async (row: Record<string, unknown>, column: string, value: string | null) => {
    const pk: Record<string, unknown> = {};
    for (const col of pkColumns) pk[col] = row[col];
    await api.updateRow(dbId, tableName, pk, { [column]: value });
    await loadData(offset, sort, filters);
  }, [dbId, tableName, pkColumns, offset, sort, filters, loadData]);

  const handleDeleteRow = useCallback(async (row: Record<string, unknown>) => {
    const pk: Record<string, unknown> = {};
    for (const col of pkColumns) pk[col] = row[col];
    await api.deleteRow(dbId, tableName, pk);
    // If we deleted the last row on a page beyond the first, step back a page
    const nextOffset = (rows.length === 1 && offset > 0) ? Math.max(0, offset - LIMIT) : offset;
    await loadData(nextOffset, sort, filters);
  }, [dbId, tableName, pkColumns, offset, rows.length, sort, filters, loadData]);

  const handleAddRow = useCallback(async (values: Record<string, string>) => {
    const payload: Record<string, unknown> = {};
    for (const [col, val] of Object.entries(values)) {
      if (val !== '') payload[col] = val;
    }
    await api.insertRow(dbId, tableName, payload);
    await loadData(0, sort, filters);
  }, [dbId, tableName, sort, filters, loadData]);

  // Close add-filter popover on outside click
  useEffect(() => {
    if (!showAddFilter) return;
    const handler = (e: MouseEvent) => {
      if (addFilterRef.current && !addFilterRef.current.contains(e.target as Node)) {
        setShowAddFilter(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAddFilter]);

  const handleSort = (column: string) => {
    setSort((prev) => {
      if (!prev || prev.column !== column) return { column, direction: 'asc' };
      if (prev.direction === 'asc') return { column, direction: 'desc' };
      return null;
    });
  };

  const openAddFilter = () => {
    setNewCol(colNames[0] ?? '');
    setNewOp('contains');
    setNewVal('');
    setShowAddFilter(true);
  };

  const commitAddFilter = () => {
    if (!newCol) return;
    const rule: FilterRule = {
      id: `${Date.now()}-${Math.random()}`,
      column: newCol,
      op: newOp,
      value: newVal,
    };
    setFilters((prev) => [...prev, rule]);
    setShowAddFilter(false);
  };

  const removeFilter = (id: string) => setFilters((prev) => prev.filter((f) => f.id !== id));

  const clearAll = () => {
    setFilters([]);
    setSort(null);
  };

  const hasActiveState = filters.length > 0 || sort !== null;
  const needsValueInput = VALUE_OPS.includes(newOp);

  return (
    <div className={`table-browser-wrapper${showProfile ? ' profile-open' : ''}`}>
      <div className="table-browser-main">
      {/* ── Toolbar ── */}
      <div className="filter-toolbar">
        <div className="filter-toolbar-controls">
          <div className="filter-toolbar-left">
            <button
              className={`btn btn-sm${showAddFilter ? ' active' : ''}`}
              onClick={openAddFilter}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Filter
              {filters.length > 0 && <span className="filter-count-badge">{filters.length}</span>}
            </button>

            {/* Active filter chips */}
            {filters.map((f) => (
              <div key={f.id} className="filter-chip">
                <span className="filter-chip-text">
                  <span className="filter-chip-col">{f.column}</span>
                  <span className="filter-chip-op">{OP_LABELS[f.op]}</span>
                  {VALUE_OPS.includes(f.op) && f.value && (
                    <span className="filter-chip-val">&ldquo;{f.value}&rdquo;</span>
                  )}
                </span>
                <button className="filter-chip-remove" onClick={() => removeFilter(f.id)} title="Remove filter">
                  ×
                </button>
              </div>
            ))}

            {/* Active sort chip */}
            {sort && (
              <div className="filter-chip sort-chip">
                <span className="filter-chip-text">
                  <span className="filter-chip-col">{sort.column}</span>
                  <span className="filter-chip-op">{sort.direction === 'asc' ? '↑ asc' : '↓ desc'}</span>
                </span>
                <button className="filter-chip-remove" onClick={() => setSort(null)} title="Remove sort">
                  ×
                </button>
              </div>
            )}

            {hasActiveState && (
              <button className="btn btn-sm btn-ghost-muted" onClick={clearAll}>
                Clear all
              </button>
            )}
          </div>

          <div className="filter-toolbar-right">
            {loading && <span className="filter-loading-indicator">Loading…</span>}
            <span className="filter-row-count">
              {total.toLocaleString()} {hasActiveState ? 'matching ' : ''}row{total !== 1 ? 's' : ''}
            </span>
            <button
              className={`btn btn-sm${showProfile ? ' btn-profile-active' : ''}`}
              onClick={() => setShowProfile((v) => !v)}
              title="Show column profile"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M3 15h18M9 3v18" />
              </svg>
              Profile
            </button>
          </div>
        </div>

        {/* ── Add-filter inline form ── */}
        {showAddFilter && (
          <div className="add-filter-form" ref={addFilterRef}>
            <select
              className="filter-select"
              value={newCol}
              onChange={(e) => setNewCol(e.target.value)}
            >
              {colNames.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <select
              className="filter-select"
              value={newOp}
              onChange={(e) => {
                const op = e.target.value as FilterOp;
                setNewOp(op);
                if (!VALUE_OPS.includes(op)) setNewVal('');
              }}
            >
              <option value="contains">contains</option>
              <option value="equals">equals</option>
              <option value="not_equals">not equals</option>
              <option value="starts_with">starts with</option>
              <option value="gt">&gt; greater than</option>
              <option value="lt">&lt; less than</option>
              <option value="gte">≥ at least</option>
              <option value="lte">≤ at most</option>
              <option value="is_null">is null</option>
              <option value="is_not_null">is not null</option>
            </select>

            {needsValueInput && (
              <input
                className="filter-value-input"
                type="text"
                placeholder="value…"
                value={newVal}
                onChange={(e) => setNewVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitAddFilter();
                  if (e.key === 'Escape') setShowAddFilter(false);
                }}
                autoFocus
              />
            )}

            <button className="btn btn-sm btn-primary" onClick={commitAddFilter} disabled={!newCol}>
              Add
            </button>
            <button className="btn btn-sm" onClick={() => setShowAddFilter(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="filter-error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      {/* ── Data table ── */}
      {!error && (
        <DataTable
          columns={columns}
          rows={rows}
          total={total}
          limit={LIMIT}
          offset={offset}
          onPageChange={(nextOffset) => loadData(nextOffset, sort, filters)}
          exportFilename={tableName}
          sortColumn={sort?.column}
          sortDirection={sort?.direction}
          onSort={handleSort}
          columnDefs={columnDefs}
          onCellEdit={handleCellEdit}
          onDeleteRow={handleDeleteRow}
          onAddRow={handleAddRow}
        />
      )}
      </div>

      {showProfile && (
        <ColumnProfilePanel
          dbId={dbId}
          tableName={tableName}
          onClose={() => setShowProfile(false)}
        />
      )}
    </div>
  );
}
