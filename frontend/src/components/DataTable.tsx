import { useState, useRef, useCallback } from 'react';

interface EditingCell {
  rowIdx: number;
  colName: string;
}

interface SavingCell {
  rowIdx: number;
  colName: string;
}

interface DeleteState {
  rowIdx: number;
  confirming: boolean;
}

interface Props {
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
  // Edit-mode props
  editMode?: boolean;
  pkColumns?: string[];
  onCellSave?: (row: Record<string, unknown>, colName: string, newValue: string | null) => Promise<void>;
  onRowDelete?: (row: Record<string, unknown>) => Promise<void>;
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

export default function DataTable({
  columns,
  rows,
  total,
  limit = 100,
  offset = 0,
  onPageChange,
  exportFilename = 'export',
  sortColumn,
  sortDirection,
  onSort,
  editMode = false,
  pkColumns = [],
  onCellSave,
  onRowDelete,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingCell, setSavingCell] = useState<SavingCell | null>(null);
  const [cellError, setCellError] = useState<string | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [deletingIdx, setDeletingIdx] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const canEdit = editMode && pkColumns.length > 0;

  const startEdit = useCallback((rowIdx: number, colName: string, currentVal: unknown) => {
    if (!canEdit) return;
    setCellError(null);
    setEditingCell({ rowIdx, colName });
    setEditValue(currentVal === null || currentVal === undefined ? '' : String(currentVal));
    setDeleteState(null);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [canEdit]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setCellError(null);
  }, []);

  const commitEdit = useCallback(async () => {
    if (!editingCell || !onCellSave) return;
    const { rowIdx, colName } = editingCell;
    const row = rows[rowIdx];
    const originalVal = row[colName];
    const newVal = editValue;
    if (String(originalVal ?? '') === newVal) {
      cancelEdit();
      return;
    }
    setSavingCell({ rowIdx, colName });
    setEditingCell(null);
    setCellError(null);
    try {
      await onCellSave(row, colName, newVal === '' ? null : newVal);
    } catch (e) {
      setCellError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingCell(null);
    }
  }, [editingCell, editValue, rows, onCellSave, cancelEdit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') cancelEdit();
  }, [commitEdit, cancelEdit]);

  const handleDeleteClick = useCallback((rowIdx: number) => {
    if (!deleteState || deleteState.rowIdx !== rowIdx) {
      setDeleteState({ rowIdx, confirming: true });
      setEditingCell(null);
    } else {
      setDeleteState(null);
    }
  }, [deleteState]);

  const handleDeleteConfirm = useCallback(async (rowIdx: number) => {
    if (!onRowDelete) return;
    setDeleteState(null);
    setDeletingIdx(rowIdx);
    try {
      await onRowDelete(rows[rowIdx]);
    } catch (e) {
      setCellError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingIdx(null);
    }
  }, [rows, onRowDelete]);

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
      {cellError && (
        <div className="crud-error-banner">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {cellError}
          <button className="crud-error-dismiss" onClick={() => setCellError(null)}>×</button>
        </div>
      )}

      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              {canEdit && <th className="delete-col-header" aria-label="Actions" />}
              {columns.map((col) => (
                <th
                  key={col}
                  className={[
                    onSort ? 'sortable-th' : '',
                    pkColumns.includes(col) ? 'pk-col-header' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={onSort ? () => onSort(col) : undefined}
                >
                  {pkColumns.includes(col) && (
                    <span className="pk-indicator" title="Primary key">🔑</span>
                  )}
                  {col}
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
            {rows.map((row, rowIdx) => {
              const isDeleting = deletingIdx === rowIdx;
              const isConfirming = deleteState?.rowIdx === rowIdx && deleteState.confirming;

              return (
                <tr
                  key={rowIdx}
                  className={[
                    isDeleting ? 'row-deleting' : '',
                    isConfirming ? 'row-confirming-delete' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {canEdit && (
                    <td className="delete-col-cell">
                      {isDeleting ? (
                        <span className="delete-spinner">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="spin">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                          </svg>
                        </span>
                      ) : isConfirming ? (
                        <div className="delete-confirm-group">
                          <button
                            className="btn btn-sm btn-delete-confirm"
                            onClick={() => handleDeleteConfirm(rowIdx)}
                            title="Confirm delete"
                          >
                            Delete
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={() => setDeleteState(null)}
                            title="Cancel"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn-row-delete"
                          onClick={() => handleDeleteClick(rowIdx)}
                          title="Delete row"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        </button>
                      )}
                    </td>
                  )}

                  {columns.map((col) => {
                    const val = row[col];
                    const isNull = val === null || val === undefined;
                    const isEditing = editingCell?.rowIdx === rowIdx && editingCell?.colName === col;
                    const isSaving = savingCell?.rowIdx === rowIdx && savingCell?.colName === col;

                    return (
                      <td
                        key={col}
                        className={[
                          isNull && !isEditing ? 'null-value' : '',
                          canEdit ? 'editable-cell' : '',
                          isEditing ? 'cell-is-editing' : '',
                          isSaving ? 'cell-saving' : '',
                        ].filter(Boolean).join(' ')}
                        onDoubleClick={canEdit && !isEditing ? () => startEdit(rowIdx, col, val) : undefined}
                        title={canEdit && !isEditing ? 'Double-click to edit' : undefined}
                      >
                        {isEditing ? (
                          <div className="cell-edit-wrapper">
                            <input
                              ref={inputRef}
                              className="cell-edit-input"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={handleKeyDown}
                              onBlur={commitEdit}
                              autoFocus
                            />
                            <button
                              className="cell-set-null-btn"
                              onMouseDown={(e) => { e.preventDefault(); setEditValue('\x00NULL\x00'); }}
                              title="Set to NULL"
                            >
                              NULL
                            </button>
                          </div>
                        ) : isSaving ? (
                          <span className="cell-saving-content">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="spin">
                              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                            </svg>
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

      {canEdit && (
        <div className="edit-mode-hint">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Double-click any cell to edit · Enter to save · Esc to cancel
          {pkColumns.length === 0 && ' · No primary key — editing disabled'}
        </div>
      )}

      <div className="table-footer">
        <div className="table-footer-left">
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
