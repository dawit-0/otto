import { useState, useRef, useEffect, useCallback } from 'react';

interface EditProps {
  editMode?: boolean;
  pkColumn?: string;
  onUpdateCell?: (pkValue: string, column: string, value: string | null) => Promise<void>;
  onDeleteRow?: (pkValue: string) => Promise<void>;
  onInsertRow?: (data: Record<string, string | null>) => Promise<void>;
}

interface Props extends EditProps {
  columns: string[];
  rows: Record<string, unknown>[];
  total?: number;
  limit?: number;
  offset?: number;
  onPageChange?: (offset: number) => void;
  exportFilename?: string;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (column: string) => void;
}

interface EditingCell {
  rowIndex: number;
  column: string;
  originalValue: string;
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

function toCSV(columns: string[], rows: Record<string, unknown>[]): string {
  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [
    columns.map(escape).join(','),
    ...rows.map((row) => columns.map((col) => escape(row[col])).join(',')),
  ];
  return lines.join('\n');
}

function toJSON(columns: string[], rows: Record<string, unknown>[]): string {
  const objects = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col) => { obj[col] = row[col] ?? null; });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

let toastCounter = 0;

export default function DataTable({
  columns, rows, total, limit = 100, offset = 0,
  onPageChange, exportFilename = 'export',
  sortColumn, sortDirection, onSort,
  editMode = false, pkColumn,
  onUpdateCell, onDeleteRow, onInsertRow,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Editing state
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingCell, setSavingCell] = useState<string | null>(null); // "rowIndex:col"
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({}); // "rowIndex:col" → error
  const [savedFlash, setSavedFlash] = useState<Set<string>>(new Set());

  // Delete state
  const [deletingRow, setDeletingRow] = useState<number | null>(null); // row index confirming delete
  const [deletingPk, setDeletingPk] = useState<string | null>(null); // pk value being deleted

  // New row state
  const [showNewRow, setShowNewRow] = useState(false);
  const [newRowData, setNewRowData] = useState<Record<string, string>>({});
  const [insertingRow, setInsertingRow] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);

  // Toast state
  const [toasts, setToasts] = useState<Toast[]>([]);

  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCell]);

  // Reset edit state when editMode turns off
  useEffect(() => {
    if (!editMode) {
      setEditingCell(null);
      setShowNewRow(false);
      setDeletingRow(null);
    }
  }, [editMode]);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  const cellKey = (rowIndex: number, col: string) => `${rowIndex}:${col}`;

  const startEdit = (rowIndex: number, column: string, currentValue: unknown) => {
    if (!editMode || !onUpdateCell || !pkColumn) return;
    const strVal = currentValue === null || currentValue === undefined ? '' : String(currentValue);
    setEditingCell({ rowIndex, column, originalValue: strVal });
    setEditValue(strVal);
    setCellErrors((prev) => {
      const next = { ...prev };
      delete next[cellKey(rowIndex, column)];
      return next;
    });
  };

  const cancelEdit = () => setEditingCell(null);

  const commitEdit = async () => {
    if (!editingCell || !pkColumn || !onUpdateCell) return;
    const { rowIndex, column, originalValue } = editingCell;
    if (editValue === originalValue) {
      setEditingCell(null);
      return;
    }
    const row = rows[rowIndex];
    const pkValue = String(row[pkColumn] ?? '');
    const key = cellKey(rowIndex, column);
    setEditingCell(null);
    setSavingCell(key);
    try {
      await onUpdateCell(pkValue, column, editValue === '' ? null : editValue);
      setSavedFlash((prev) => new Set(prev).add(key));
      setTimeout(() => setSavedFlash((prev) => { const s = new Set(prev); s.delete(key); return s; }), 900);
    } catch (e) {
      setCellErrors((prev) => ({ ...prev, [key]: e instanceof Error ? e.message : 'Save failed' }));
      showToast(`Failed to save: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
    } finally {
      setSavingCell(null);
    }
  };

  const handleCellKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  };

  const confirmDelete = (rowIndex: number) => {
    if (!pkColumn) return;
    const pkVal = String(rows[rowIndex][pkColumn] ?? '');
    setDeletingRow(rowIndex);
    setDeletingPk(pkVal);
  };

  const cancelDelete = () => { setDeletingRow(null); setDeletingPk(null); };

  const executeDelete = async () => {
    if (deletingPk === null || !pkColumn || !onDeleteRow) return;
    const pkVal = deletingPk;
    setDeletingRow(null);
    setDeletingPk(null);
    try {
      await onDeleteRow(pkVal);
      showToast('Row deleted', 'success');
    } catch (e) {
      showToast(`Delete failed: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
    }
  };

  const openNewRow = () => {
    const empty: Record<string, string> = {};
    columns.forEach((c) => { empty[c] = ''; });
    setNewRowData(empty);
    setInsertError(null);
    setShowNewRow(true);
  };

  const cancelNewRow = () => setShowNewRow(false);

  const commitInsert = async () => {
    if (!onInsertRow) return;
    const data: Record<string, string | null> = {};
    Object.entries(newRowData).forEach(([k, v]) => {
      if (v !== '') data[k] = v;
    });
    if (Object.keys(data).length === 0) {
      setInsertError('Fill in at least one column');
      return;
    }
    setInsertingRow(true);
    setInsertError(null);
    try {
      await onInsertRow(data);
      setShowNewRow(false);
      showToast('Row inserted', 'success');
    } catch (e) {
      setInsertError(e instanceof Error ? e.message : 'Insert failed');
    } finally {
      setInsertingRow(false);
    }
  };

  if (columns.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">{'{ }'}</div>
        <div className="empty-state-title">No results</div>
        <div className="empty-state-text">Run a query to see results here.</div>
      </div>
    );
  }

  const hasPagination = total !== undefined && total > limit;
  const page = Math.floor(offset / limit) + 1;
  const totalPages = total ? Math.ceil(total / limit) : 1;

  const triggerCopy = (type: 'csv' | 'json', text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopyState(type);
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => setCopyState(null), 1800);
    });
  };

  const handleDownloadCSV = () =>
    downloadFile(`${exportFilename}.csv`, toCSV(columns, rows), 'text/csv;charset=utf-8;');

  const handleCopyCSV = () => triggerCopy('csv', toCSV(columns, rows));
  const handleCopyJSON = () => triggerCopy('json', toJSON(columns, rows));

  return (
    <div className="table-browser">
      {/* Toast container */}
      <div className="edit-toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`edit-toast edit-toast-${t.type}`}>
            {t.type === 'success' ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
            {t.message}
          </div>
        ))}
      </div>

      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              {editMode && pkColumn && <th className="row-action-col" />}
              {columns.map((col) => (
                <th
                  key={col}
                  className={onSort ? 'sortable-th' : ''}
                  onClick={onSort ? () => onSort(col) : undefined}
                >
                  {col}
                  {col === pkColumn && editMode && (
                    <span className="pk-badge" title="Primary key">PK</span>
                  )}
                  {onSort && (
                    <span className="sort-arrow">
                      {sortColumn === col ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* New row form */}
            {showNewRow && (
              <tr className="new-row-form-row">
                {editMode && pkColumn && <td className="row-action-col" />}
                {columns.map((col) => (
                  <td key={col} className="new-row-cell">
                    <input
                      className="cell-input new-row-input"
                      type="text"
                      placeholder={col === pkColumn ? 'auto' : col}
                      value={newRowData[col] ?? ''}
                      onChange={(e) => setNewRowData((prev) => ({ ...prev, [col]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitInsert();
                        if (e.key === 'Escape') cancelNewRow();
                      }}
                      disabled={insertingRow}
                    />
                  </td>
                ))}
              </tr>
            )}

            {rows.map((row, rowIndex) => {
              const isConfirmingDelete = deletingRow === rowIndex;
              return (
                <tr key={rowIndex} className={isConfirmingDelete ? 'row-deleting-confirm' : ''}>
                  {editMode && pkColumn && (
                    <td className="row-action-col">
                      {isConfirmingDelete ? (
                        <div className="delete-confirm-inline">
                          <button className="btn-delete-confirm" onClick={executeDelete} title="Yes, delete">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </button>
                          <button className="btn-delete-cancel" onClick={cancelDelete} title="Cancel">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <button
                          className="row-delete-btn"
                          onClick={() => confirmDelete(rowIndex)}
                          title="Delete row"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          </svg>
                        </button>
                      )}
                    </td>
                  )}
                  {columns.map((col) => {
                    const val = row[col];
                    const isNull = val === null || val === undefined;
                    const key = cellKey(rowIndex, col);
                    const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.column === col;
                    const isSaving = savingCell === key;
                    const hasError = !!cellErrors[key];
                    const isFlashing = savedFlash.has(key);
                    const isEditableCol = editMode && pkColumn && col !== pkColumn && onUpdateCell;

                    return (
                      <td
                        key={col}
                        className={[
                          isNull && !isEditing ? 'null-value' : '',
                          isEditableCol ? 'editable-cell' : '',
                          isEditing ? 'cell-editing' : '',
                          isSaving ? 'cell-saving' : '',
                          hasError ? 'cell-error' : '',
                          isFlashing ? 'cell-saved-flash' : '',
                        ].filter(Boolean).join(' ')}
                        title={hasError ? cellErrors[key] : undefined}
                        onDoubleClick={isEditableCol ? () => startEdit(rowIndex, col, val) : undefined}
                      >
                        {isEditing ? (
                          <input
                            ref={editInputRef}
                            className="cell-input"
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={handleCellKeyDown}
                            onBlur={commitEdit}
                          />
                        ) : isSaving ? (
                          <span className="cell-saving-spinner">
                            <span className="spinner-dot" />
                            {isNull ? 'NULL' : String(val)}
                          </span>
                        ) : (
                          isNull ? 'NULL' : String(val)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* New row controls */}
      {showNewRow && (
        <div className="new-row-controls">
          {insertError && <span className="new-row-error">{insertError}</span>}
          <button className="btn btn-sm btn-primary" onClick={commitInsert} disabled={insertingRow}>
            {insertingRow ? 'Saving…' : 'Save row'}
          </button>
          <button className="btn btn-sm" onClick={cancelNewRow} disabled={insertingRow}>
            Cancel
          </button>
        </div>
      )}

      <div className="table-footer">
        <div className="table-footer-left">
          {editMode && pkColumn && onInsertRow && !showNewRow && (
            <button className="btn btn-sm btn-add-row" onClick={openNewRow} title="Insert a new row">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add row
            </button>
          )}
          {hasPagination && onPageChange ? (
            <>
              <button
                className="btn btn-sm"
                disabled={offset === 0}
                onClick={() => onPageChange(Math.max(0, offset - limit))}
              >
                Previous
              </button>
              <span className="table-footer-page">
                Page {page} of {totalPages}
              </span>
              <button
                className="btn btn-sm"
                disabled={offset + limit >= total!}
                onClick={() => onPageChange(offset + limit)}
              >
                Next
              </button>
              <span className="table-footer-info">
                {offset + 1}–{Math.min(offset + limit, total!)} of {total!.toLocaleString()} rows
              </span>
            </>
          ) : (
            <span className="table-footer-info">
              {rows.length} row{rows.length !== 1 ? 's' : ''}
              {total !== undefined && total > rows.length && ` of ${total.toLocaleString()} total`}
            </span>
          )}
        </div>

        <div className="table-footer-right">
          <button
            className="btn btn-sm"
            onClick={handleDownloadCSV}
            title="Download visible rows as a CSV file"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download CSV
          </button>
          <button
            className={`btn btn-sm${copyState === 'csv' ? ' btn-copy-success' : ''}`}
            onClick={handleCopyCSV}
            title="Copy as CSV to clipboard"
          >
            {copyState === 'csv' ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Copied!
              </>
            ) : 'Copy CSV'}
          </button>
          <button
            className={`btn btn-sm${copyState === 'json' ? ' btn-copy-success' : ''}`}
            onClick={handleCopyJSON}
            title="Copy as JSON array to clipboard"
          >
            {copyState === 'json' ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Copied!
              </>
            ) : 'Copy JSON'}
          </button>
        </div>
      </div>
    </div>
  );
}
