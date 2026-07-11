import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type FilterRule, type FilterOp, type Column } from '../api';
import DataTable from './DataTable';
import ColumnProfilePanel from './ColumnProfilePanel';
import InsertRowModal from './InsertRowModal';

interface Props {
  dbId: string;
  tableName: string;
  columnDefs: Column[];
}

interface SortState {
  column: string;
  direction: 'asc' | 'desc';
}

interface EditingCell {
  rowIndex: number;
  column: string;
  value: string;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
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

  // ── Edit mode state ──
  const [editMode, setEditMode] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [cellSaving, setCellSaving] = useState(false);
  const [cellError, setCellError] = useState<string | null>(null);
  const [showInsertModal, setShowInsertModal] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const addFilterRef = useRef<HTMLDivElement>(null);

  const colNames = columnDefs.map((c) => c.name);
  const pkColumn = columnDefs.find((c) => c.pk)?.name ?? null;

  const showToast = useCallback((message: string, type: Toast['type']) => {
    setToast({ message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

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

  useEffect(() => {
    loadData(0, sort, filters);
  }, [dbId, tableName, sort, filters, loadData]);

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

  // Focus the edit input whenever editingCell changes
  useEffect(() => {
    if (editingCell) {
      requestAnimationFrame(() => {
        editInputRef.current?.focus();
        editInputRef.current?.select();
      });
    }
  }, [editingCell]);

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

  const toggleEditMode = () => {
    setEditMode((v) => {
      if (v) {
        setSelectedRows(new Set());
        setEditingCell(null);
        setCellError(null);
        setDeleteConfirming(false);
      }
      return !v;
    });
  };

  // ── Row selection ──

  const toggleRowSelection = (idx: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAllRows = () => {
    if (selectedRows.size === rows.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(rows.map((_, i) => i)));
    }
  };

  // ── Inline cell editing ──

  const startEditCell = (rowIndex: number, column: string) => {
    if (cellSaving) return;
    const val = rows[rowIndex][column];
    setEditingCell({
      rowIndex,
      column,
      value: val === null || val === undefined ? '' : String(val),
    });
    setCellError(null);
  };

  const cancelEditCell = () => {
    setEditingCell(null);
    setCellError(null);
  };

  const commitEditCell = async () => {
    if (!editingCell || !pkColumn) return;
    const { rowIndex, column, value } = editingCell;
    const pkValue = rows[rowIndex][pkColumn];
    const originalValue = rows[rowIndex][column];
    const newValue = value === '' ? null : value;

    if (newValue === null && (originalValue === null || originalValue === undefined)) {
      cancelEditCell();
      return;
    }
    if (newValue !== null && String(originalValue) === value) {
      cancelEditCell();
      return;
    }

    setCellSaving(true);
    setCellError(null);
    try {
      await api.updateTableRow(dbId, tableName, pkColumn, pkValue, { [column]: newValue });
      setRows((prev) => {
        const next = [...prev];
        next[rowIndex] = { ...next[rowIndex], [column]: newValue };
        return next;
      });
      setEditingCell(null);
      showToast('Row updated', 'success');
    } catch (e) {
      setCellError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setCellSaving(false);
    }
  };

  const handleCellKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEditCell(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEditCell(); }
  };

  // ── Insert row ──

  const handleInsert = async (values: Record<string, unknown>) => {
    await api.insertTableRow(dbId, tableName, values);
    showToast('Row inserted', 'success');
    await loadData(0, sort, filters);
  };

  // ── Delete rows ──

  const handleDeleteSelected = async () => {
    if (!pkColumn || selectedRows.size === 0) return;
    setDeleting(true);
    try {
      const pkValues = [...selectedRows].map((i) => rows[i][pkColumn]);
      await api.deleteTableRows(dbId, tableName, pkColumn, pkValues);
      showToast(`Deleted ${pkValues.length} row${pkValues.length !== 1 ? 's' : ''}`, 'success');
      setSelectedRows(new Set());
      setDeleteConfirming(false);
      await loadData(offset, sort, filters);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const hasActiveState = filters.length > 0 || sort !== null;
  const needsValueInput = VALUE_OPS.includes(newOp);
  const allSelected = rows.length > 0 && selectedRows.size === rows.length;
  const someSelected = selectedRows.size > 0 && !allSelected;

  const renderCellValue = (rowIndex: number, col: string) => {
    const val = rows[rowIndex][col];
    const isNull = val === null || val === undefined;

    if (editMode && editingCell?.rowIndex === rowIndex && editingCell.column === col) {
      return (
        <div className="cell-edit-wrapper">
          <input
            ref={editInputRef}
            className="cell-edit-input"
            value={editingCell.value}
            onChange={(e) => setEditingCell((prev) => prev ? { ...prev, value: e.target.value } : null)}
            onKeyDown={handleCellKeyDown}
            onBlur={commitEditCell}
            disabled={cellSaving}
          />
          {cellError && <div className="cell-edit-error">{cellError}</div>}
        </div>
      );
    }

    return (
      <span className={isNull ? 'cell-null' : ''}>
        {isNull ? 'NULL' : String(val)}
      </span>
    );
  };

  const hasPagination = total > LIMIT;
  const page = Math.floor(offset / LIMIT) + 1;
  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className={`table-browser-wrapper${showProfile ? ' profile-open' : ''}`}>
      <div className="table-browser-main">

        {/* ── Toast ── */}
        {toast && (
          <div className={`crud-toast crud-toast-${toast.type}`}>
            {toast.type === 'success' ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
            {toast.message}
          </div>
        )}

        {/* ── Toolbar ── */}
        <div className="filter-toolbar">
          <div className="filter-toolbar-controls">
            <div className="filter-toolbar-left">
              <button
                className={`btn btn-sm${showAddFilter ? ' active' : ''}`}
                onClick={openAddFilter}
                disabled={editMode}
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
                  <button className="filter-chip-remove" onClick={() => removeFilter(f.id)} title="Remove filter">×</button>
                </div>
              ))}

              {sort && (
                <div className="filter-chip sort-chip">
                  <span className="filter-chip-text">
                    <span className="filter-chip-col">{sort.column}</span>
                    <span className="filter-chip-op">{sort.direction === 'asc' ? '↑ asc' : '↓ desc'}</span>
                  </span>
                  <button className="filter-chip-remove" onClick={() => setSort(null)} title="Remove sort">×</button>
                </div>
              )}

              {hasActiveState && !editMode && (
                <button className="btn btn-sm btn-ghost-muted" onClick={clearAll}>Clear all</button>
              )}
            </div>

            <div className="filter-toolbar-right">
              {loading && <span className="filter-loading-indicator">Loading…</span>}
              {!editMode && (
                <span className="filter-row-count">
                  {total.toLocaleString()} {hasActiveState ? 'matching ' : ''}row{total !== 1 ? 's' : ''}
                </span>
              )}

              {/* Edit mode actions */}
              {editMode && (
                <div className="edit-mode-actions">
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => setShowInsertModal(true)}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Insert Row
                  </button>
                  {selectedRows.size > 0 && pkColumn && (
                    <>
                      {deleteConfirming ? (
                        <>
                          <span className="delete-confirm-text">
                            Delete {selectedRows.size} row{selectedRows.size !== 1 ? 's' : ''}?
                          </span>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={handleDeleteSelected}
                            disabled={deleting}
                          >
                            {deleting ? 'Deleting…' : 'Confirm'}
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={() => setDeleteConfirming(false)}
                            disabled={deleting}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => setDeleteConfirming(true)}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          </svg>
                          Delete {selectedRows.size} row{selectedRows.size !== 1 ? 's' : ''}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              <button
                className={`btn btn-sm${editMode ? ' edit-mode-active' : ''}`}
                onClick={toggleEditMode}
                title={editMode ? 'Exit edit mode' : 'Edit table data'}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                {editMode ? 'Done' : 'Edit'}
              </button>

              {!editMode && (
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
              )}
            </div>
          </div>

          {/* ── Add-filter form ── */}
          {showAddFilter && (
            <div className="add-filter-form" ref={addFilterRef}>
              <select className="filter-select" value={newCol} onChange={(e) => setNewCol(e.target.value)}>
                {colNames.map((c) => (<option key={c} value={c}>{c}</option>))}
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
              <button className="btn btn-sm btn-primary" onClick={commitAddFilter} disabled={!newCol}>Add</button>
              <button className="btn btn-sm" onClick={() => setShowAddFilter(false)}>Cancel</button>
            </div>
          )}
        </div>

        {/* ── No-PK edit warning ── */}
        {editMode && !pkColumn && (
          <div className="no-pk-warning">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            This table has no primary key — cell editing and deletion are unavailable. You can still insert rows.
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="filter-error">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        {/* ── Data ── */}
        {!error && !editMode && (
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
          />
        )}

        {!error && editMode && (
          <div className="table-browser">
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="checkbox-th">
                      <input
                        type="checkbox"
                        className="row-checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={toggleAllRows}
                        title="Select all rows"
                      />
                    </th>
                    {columns.map((col) => {
                      const def = columnDefs.find((c) => c.name === col);
                      const isPk = def?.pk ?? false;
                      return (
                        <th key={col}>
                          {col}
                          {isPk && <span className="col-pk-badge">PK</span>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((_row, rowIdx) => {
                    const isSelected = selectedRows.has(rowIdx);
                    return (
                      <tr
                        key={rowIdx}
                        className={isSelected ? 'row-selected' : ''}
                      >
                        <td className="checkbox-td" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="row-checkbox"
                            checked={isSelected}
                            onChange={() => toggleRowSelection(rowIdx)}
                          />
                        </td>
                        {columns.map((col) => {
                          const isEditing = editingCell?.rowIndex === rowIdx && editingCell.column === col;
                          const canEdit = !!pkColumn;
                          return (
                            <td
                              key={col}
                              className={`${isEditing ? 'cell-editing' : ''}${!canEdit ? ' cell-readonly' : ''}`}
                              onClick={canEdit && !isEditing ? () => startEditCell(rowIdx, col) : undefined}
                              title={canEdit && !isEditing ? 'Click to edit' : undefined}
                            >
                              {renderCellValue(rowIdx, col)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={columns.length + 1} className="editable-table-empty">
                        No rows. Click "Insert Row" to add one.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Edit mode footer */}
            <div className="table-footer">
              <div className="table-footer-left">
                {hasPagination ? (
                  <>
                    <button
                      className="btn btn-sm"
                      disabled={offset === 0}
                      onClick={() => loadData(Math.max(0, offset - LIMIT), sort, filters)}
                    >
                      Previous
                    </button>
                    <span className="table-footer-page">Page {page} of {totalPages}</span>
                    <button
                      className="btn btn-sm"
                      disabled={offset + LIMIT >= total}
                      onClick={() => loadData(offset + LIMIT, sort, filters)}
                    >
                      Next
                    </button>
                    <span className="table-footer-info">
                      {offset + 1}–{Math.min(offset + LIMIT, total)} of {total.toLocaleString()} rows
                    </span>
                  </>
                ) : (
                  <span className="table-footer-info">
                    {rows.length} row{rows.length !== 1 ? 's' : ''}
                    {selectedRows.size > 0 && ` · ${selectedRows.size} selected`}
                  </span>
                )}
              </div>
              <div className="table-footer-right">
                <span className="edit-mode-hint">
                  {pkColumn ? 'Click any cell to edit · Enter to save · Esc to cancel' : 'Insert-only mode (no primary key)'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {showProfile && !editMode && (
        <ColumnProfilePanel
          dbId={dbId}
          tableName={tableName}
          onClose={() => setShowProfile(false)}
        />
      )}

      {showInsertModal && (
        <InsertRowModal
          columns={columnDefs}
          onInsert={handleInsert}
          onClose={() => setShowInsertModal(false)}
        />
      )}
    </div>
  );
}
