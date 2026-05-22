import { useState, useRef, useCallback } from 'react';

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
  // Edit mode
  editMode?: boolean;
  primaryKeys?: string[];
  onSaveRow?: (originalRow: Record<string, unknown>, updates: Record<string, unknown>) => Promise<void>;
  onDeleteRow?: (originalRow: Record<string, unknown>) => Promise<void>;
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

// Sentinel to distinguish "the user explicitly set this to NULL" from "not edited"
const NULL_SENTINEL = Symbol('null');
type CellValue = string | typeof NULL_SENTINEL;

export default function DataTable({
  columns, rows, total, limit = 100, offset = 0, onPageChange,
  exportFilename = 'export', sortColumn, sortDirection, onSort,
  editMode = false, primaryKeys = [], onSaveRow, onDeleteRow,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // rowEdits: rowIndex → { colName → CellValue }
  const [rowEdits, setRowEdits] = useState<Map<number, Record<string, CellValue>>>(new Map());
  const [activeCell, setActiveCell] = useState<{ rowIdx: number; col: string } | null>(null);
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null);
  const [savingRows, setSavingRows] = useState<Set<number>>(new Set());
  const [rowErrors, setRowErrors] = useState<Map<number, string>>(new Map());

  const pkSet = new Set(primaryKeys);

  // ── Edit helpers ──────────────────────────────────────────────────────────

  const stageEdit = useCallback((rowIdx: number, col: string, value: CellValue) => {
    setRowEdits((prev) => {
      const next = new Map(prev);
      const rowMap = { ...(next.get(rowIdx) ?? {}) };
      rowMap[col] = value;
      next.set(rowIdx, rowMap);
      return next;
    });
  }, []);

  const cancelRowEdits = useCallback((rowIdx: number) => {
    setRowEdits((prev) => {
      const next = new Map(prev);
      next.delete(rowIdx);
      return next;
    });
    setActiveCell((a) => (a?.rowIdx === rowIdx ? null : a));
    setRowErrors((prev) => { const next = new Map(prev); next.delete(rowIdx); return next; });
  }, []);

  const handleSaveRow = useCallback(async (rowIdx: number) => {
    const edits = rowEdits.get(rowIdx);
    if (!edits || !onSaveRow) return;
    const originalRow = rows[rowIdx];

    // Build pk_values and updates
    const updates: Record<string, unknown> = {};
    for (const [col, val] of Object.entries(edits)) {
      updates[col] = val === NULL_SENTINEL ? null : val;
    }

    setSavingRows((prev) => new Set(prev).add(rowIdx));
    setRowErrors((prev) => { const next = new Map(prev); next.delete(rowIdx); return next; });
    try {
      await onSaveRow(originalRow, updates);
      cancelRowEdits(rowIdx);
    } catch (e) {
      setRowErrors((prev) => {
        const next = new Map(prev);
        next.set(rowIdx, e instanceof Error ? e.message : 'Save failed');
        return next;
      });
    } finally {
      setSavingRows((prev) => { const next = new Set(prev); next.delete(rowIdx); return next; });
    }
  }, [rowEdits, rows, onSaveRow, cancelRowEdits]);

  const handleDeleteRow = useCallback(async (rowIdx: number) => {
    if (!onDeleteRow) return;
    const originalRow = rows[rowIdx];
    setSavingRows((prev) => new Set(prev).add(rowIdx));
    setRowErrors((prev) => { const next = new Map(prev); next.delete(rowIdx); return next; });
    try {
      await onDeleteRow(originalRow);
      setConfirmDeleteIdx(null);
    } catch (e) {
      setRowErrors((prev) => {
        const next = new Map(prev);
        next.set(rowIdx, e instanceof Error ? e.message : 'Delete failed');
        return next;
      });
      setConfirmDeleteIdx(null);
    } finally {
      setSavingRows((prev) => { const next = new Set(prev); next.delete(rowIdx); return next; });
    }
  }, [rows, onDeleteRow]);

  // ── Reset edit state when rows change (page change, reload, etc.) ─────────
  const prevRowsRef = useRef(rows);
  if (prevRowsRef.current !== rows) {
    prevRowsRef.current = rows;
    if (rowEdits.size > 0) setRowEdits(new Map());
    if (activeCell) setActiveCell(null);
    if (confirmDeleteIdx !== null) setConfirmDeleteIdx(null);
    if (rowErrors.size > 0) setRowErrors(new Map());
  }

  // ── Copy / export ─────────────────────────────────────────────────────────

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
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  className={`${onSort ? 'sortable-th' : ''}${pkSet.has(col) ? ' pk-col-header' : ''}`}
                  onClick={onSort ? () => onSort(col) : undefined}
                >
                  {pkSet.has(col) && <span className="pk-badge" title="Primary key">🔑</span>}
                  {col}
                  {onSort && (
                    <span className="sort-arrow">
                      {sortColumn === col ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅'}
                    </span>
                  )}
                </th>
              ))}
              {editMode && <th className="row-action-col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => {
              const edits = rowEdits.get(rowIdx);
              const hasEdits = !!edits && Object.keys(edits).length > 0;
              const isConfirmingDelete = confirmDeleteIdx === rowIdx;
              const isSaving = savingRows.has(rowIdx);
              const rowError = rowErrors.get(rowIdx);

              return (
                <>
                  <tr
                    key={rowIdx}
                    className={[
                      hasEdits ? 'row-modified' : '',
                      isConfirmingDelete ? 'row-deleting' : '',
                      isSaving ? 'row-saving' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {columns.map((col) => {
                      const isPK = pkSet.has(col);
                      const isActive = editMode && activeCell?.rowIdx === rowIdx && activeCell?.col === col;
                      const editedVal = edits?.[col];
                      const origVal = row[col];
                      const origIsNull = origVal === null || origVal === undefined;
                      const hasEdit = editedVal !== undefined;
                      const displayIsNull = hasEdit
                        ? editedVal === NULL_SENTINEL
                        : origIsNull;
                      const displayVal = hasEdit && editedVal !== NULL_SENTINEL
                        ? String(editedVal)
                        : !hasEdit && !origIsNull
                          ? String(origVal)
                          : null;

                      if (isActive && !isPK) {
                        const inputVal = editedVal !== undefined && editedVal !== NULL_SENTINEL
                          ? String(editedVal)
                          : (editedVal === NULL_SENTINEL ? '' : (origIsNull ? '' : String(origVal)));
                        const isNullMode = editedVal === NULL_SENTINEL ||
                          (editedVal === undefined && origIsNull);

                        return (
                          <td key={col} className="editing-cell">
                            {isNullMode ? (
                              <div className="cell-null-edit">
                                <span className="cell-null-tag">NULL</span>
                                <button
                                  className="cell-null-clear"
                                  onMouseDown={(e) => { e.preventDefault(); stageEdit(rowIdx, col, ''); }}
                                  title="Clear NULL — set to empty string"
                                >
                                  Clear
                                </button>
                              </div>
                            ) : (
                              <div className="cell-input-wrapper">
                                <input
                                  className="cell-input"
                                  value={inputVal}
                                  onChange={(e) => stageEdit(rowIdx, col, e.target.value)}
                                  onBlur={() => setActiveCell(null)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') { e.preventDefault(); setActiveCell(null); }
                                    if (e.key === 'Escape') { e.preventDefault(); setActiveCell(null); }
                                    if (e.key === 'Tab') setActiveCell(null);
                                  }}
                                  autoFocus
                                />
                                <button
                                  className="cell-set-null-btn"
                                  onMouseDown={(e) => { e.preventDefault(); stageEdit(rowIdx, col, NULL_SENTINEL); }}
                                  title="Set to NULL"
                                >
                                  ∅
                                </button>
                              </div>
                            )}
                          </td>
                        );
                      }

                      return (
                        <td
                          key={col}
                          className={[
                            displayIsNull ? 'null-value' : '',
                            editMode && !isPK ? 'editable-cell' : '',
                            hasEdit ? 'cell-modified' : '',
                          ].filter(Boolean).join(' ')}
                          onClick={editMode && !isPK && !isSaving
                            ? () => setActiveCell({ rowIdx, col })
                            : undefined}
                          title={editMode && !isPK ? 'Click to edit' : undefined}
                        >
                          {displayIsNull ? 'NULL' : displayVal}
                        </td>
                      );
                    })}

                    {editMode && (
                      <td className="row-actions">
                        {isConfirmingDelete ? (
                          <div className="delete-confirm">
                            <span className="delete-confirm-label">Delete row?</span>
                            <button
                              className="row-action-btn row-action-confirm-delete"
                              onClick={() => handleDeleteRow(rowIdx)}
                              disabled={isSaving}
                            >
                              Delete
                            </button>
                            <button
                              className="row-action-btn row-action-cancel"
                              onClick={() => setConfirmDeleteIdx(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="row-action-btns">
                            {hasEdits && (
                              <>
                                <button
                                  className="row-action-btn row-action-save"
                                  onClick={() => handleSaveRow(rowIdx)}
                                  disabled={isSaving}
                                  title="Save changes"
                                >
                                  {isSaving ? '…' : '✓'}
                                </button>
                                <button
                                  className="row-action-btn row-action-cancel"
                                  onClick={() => cancelRowEdits(rowIdx)}
                                  disabled={isSaving}
                                  title="Discard changes"
                                >
                                  ✕
                                </button>
                              </>
                            )}
                            <button
                              className="row-action-btn row-action-delete"
                              onClick={() => setConfirmDeleteIdx(rowIdx)}
                              disabled={isSaving}
                              title="Delete row"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-1 14H6L5 6" />
                                <path d="M10 11v6M14 11v6" />
                                <path d="M9 6V4h6v2" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                  {rowError && (
                    <tr key={`${rowIdx}-err`} className="row-error-row">
                      <td colSpan={columns.length + (editMode ? 1 : 0)} className="row-error-cell">
                        {rowError}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

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
