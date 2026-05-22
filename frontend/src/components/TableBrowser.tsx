import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type FilterRule, type FilterOp, type Column } from '../api';
import DataTable from './DataTable';

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

// ── Add Row Modal ─────────────────────────────────────────────────────────────

interface AddRowModalProps {
  columnDefs: Column[];
  onClose: () => void;
  onInsert: (values: Record<string, unknown>) => Promise<void>;
}

function AddRowModal({ columnDefs, onClose, onInsert }: AddRowModalProps) {
  const initialValues = Object.fromEntries(
    columnDefs.map((c) => [c.name, c.default ?? '']),
  ) as Record<string, string | null>;

  const [values, setValues] = useState<Record<string, string | null>>(initialValues);
  const [isNull, setIsNull] = useState<Record<string, boolean>>(
    Object.fromEntries(columnDefs.map((c) => [c.name, false])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const payload: Record<string, unknown> = {};
    for (const col of columnDefs) {
      const val = values[col.name];
      // Skip empty PK fields (let the DB auto-assign)
      if (col.pk && (val === '' || val === null || isNull[col.name])) continue;
      payload[col.name] = isNull[col.name] ? null : (val ?? null);
    }
    setSaving(true);
    try {
      await onInsert(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Insert failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal add-row-modal">
        <div className="modal-header">
          <span className="modal-title">Add Row</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body add-row-body">
            {columnDefs.map((col) => (
              <div key={col.name} className="add-row-field">
                <label className="add-row-label">
                  <span className="add-row-col-name">{col.name}</span>
                  <span className="add-row-col-meta">
                    {col.type && <span className="add-row-col-type">{col.type}</span>}
                    {col.pk && <span className="add-row-col-badge pk">PK</span>}
                    {col.notnull && !col.pk && <span className="add-row-col-badge required">required</span>}
                  </span>
                </label>
                <div className="add-row-input-row">
                  {isNull[col.name] ? (
                    <div className="add-row-null-field">
                      <span className="cell-null-tag">NULL</span>
                      <button
                        type="button"
                        className="cell-null-clear"
                        onClick={() => setIsNull((p) => ({ ...p, [col.name]: false }))}
                      >
                        Clear
                      </button>
                    </div>
                  ) : (
                    <input
                      className="add-row-input"
                      type="text"
                      value={values[col.name] ?? ''}
                      placeholder={col.pk ? '(auto)' : col.notnull ? 'required' : 'optional'}
                      onChange={(e) => setValues((p) => ({ ...p, [col.name]: e.target.value }))}
                    />
                  )}
                  {!col.notnull && !col.pk && (
                    <button
                      type="button"
                      className="cell-set-null-btn"
                      title="Set to NULL"
                      onClick={() => setIsNull((p) => ({ ...p, [col.name]: !p[col.name] }))}
                      style={isNull[col.name] ? { color: 'var(--warning)' } : undefined}
                    >
                      ∅
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {error && <div className="add-row-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Inserting…' : 'Add Row'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── TableBrowser ──────────────────────────────────────────────────────────────

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

  const [editMode, setEditMode] = useState(false);
  const [showAddRow, setShowAddRow] = useState(false);

  const addFilterRef = useRef<HTMLDivElement>(null);

  const colNames = columnDefs.map((c) => c.name);
  const primaryKeys = columnDefs.filter((c) => c.pk).map((c) => c.name);
  const canEdit = primaryKeys.length > 0;

  const loadData = useCallback(async (nextOffset: number, currentSort: SortState | null, currentFilters: FilterRule[]) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getTableData(
        dbId, tableName, LIMIT, nextOffset,
        currentSort?.column, currentSort?.direction, currentFilters,
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

  useEffect(() => {
    loadData(0, sort, filters);
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

  // Exit edit mode when table changes
  useEffect(() => {
    setEditMode(false);
    setShowAddRow(false);
  }, [dbId, tableName]);

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

  // ── Row mutation callbacks ──────────────────────────────────────────────────

  const handleSaveRow = useCallback(async (
    originalRow: Record<string, unknown>,
    updates: Record<string, unknown>,
  ) => {
    const pkValues: Record<string, unknown> = {};
    for (const pk of primaryKeys) {
      pkValues[pk] = originalRow[pk];
    }
    await api.updateTableRow(dbId, tableName, pkValues, updates);
    await loadData(offset, sort, filters);
  }, [dbId, tableName, primaryKeys, offset, sort, filters, loadData]);

  const handleDeleteRow = useCallback(async (originalRow: Record<string, unknown>) => {
    const pkValues: Record<string, unknown> = {};
    for (const pk of primaryKeys) {
      pkValues[pk] = originalRow[pk];
    }
    await api.deleteTableRow(dbId, tableName, pkValues);
    await loadData(offset, sort, filters);
  }, [dbId, tableName, primaryKeys, offset, sort, filters, loadData]);

  const handleInsertRow = useCallback(async (values: Record<string, unknown>) => {
    await api.insertTableRow(dbId, tableName, values);
    await loadData(0, sort, filters);
  }, [dbId, tableName, sort, filters, loadData]);

  const hasActiveState = filters.length > 0 || sort !== null;
  const needsValueInput = VALUE_OPS.includes(newOp);

  return (
    <div className="table-browser-wrapper">
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

            {/* Edit mode controls */}
            {editMode && canEdit && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => setShowAddRow(true)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add Row
              </button>
            )}

            <button
              className={`btn btn-sm edit-mode-toggle${editMode ? ' edit-mode-active' : ''}`}
              onClick={() => {
                if (!canEdit) return;
                setEditMode((v) => !v);
              }}
              title={
                !canEdit
                  ? 'Editing is disabled: table has no primary key'
                  : editMode
                    ? 'Exit edit mode'
                    : 'Edit rows'
              }
              disabled={!canEdit}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              {editMode ? 'Done' : 'Edit'}
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
          editMode={editMode}
          primaryKeys={primaryKeys}
          onSaveRow={handleSaveRow}
          onDeleteRow={handleDeleteRow}
        />
      )}

      {/* ── Add Row Modal ── */}
      {showAddRow && (
        <AddRowModal
          columnDefs={columnDefs}
          onClose={() => setShowAddRow(false)}
          onInsert={handleInsertRow}
        />
      )}
    </div>
  );
}
