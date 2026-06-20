import { useState, useRef } from 'react';
import type { Column } from '../api';

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
  /** Column metadata (used to mark primary keys read-only and hint input types). */
  columnDefs?: Column[];
  /** Allow editing existing cells / deleting rows. Requires the table to have a primary key. */
  editable?: boolean;
  onCellEdit?: (row: Record<string, unknown>, column: string, value: string) => Promise<void>;
  onDeleteRow?: (row: Record<string, unknown>) => Promise<void>;
  /** Insert doesn't require a primary key, so it's offered independently of `editable`. */
  onInsertRow?: (values: Record<string, string>) => Promise<void>;
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

interface EditingCell {
  row: number;
  col: string;
}

export default function DataTable({
  columns, rows, total, limit = 100, offset = 0, onPageChange, exportFilename = 'export',
  sortColumn, sortDirection, onSort, columnDefs, editable = false, onCellEdit, onDeleteRow, onInsertRow,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState('');
  const [cellError, setCellError] = useState<string | null>(null);
  const [savingCell, setSavingCell] = useState(false);

  const [confirmDeleteRow, setConfirmDeleteRow] = useState<number | null>(null);
  const [deletingRow, setDeletingRow] = useState(false);
  const [rowActionError, setRowActionError] = useState<string | null>(null);

  const [showAddRow, setShowAddRow] = useState(false);
  const [newRowValues, setNewRowValues] = useState<Record<string, string>>({});
  const [savingNewRow, setSavingNewRow] = useState(false);

  if (columns.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">{'{ }'}</div>
        <div className="empty-state-title">No results</div>
        <div className="empty-state-text">Run a query to see results here.</div>
      </div>
    );
  }

  const isPk = (col: string) => !!columnDefs?.find((c) => c.name === col)?.pk;
  const canEditCell = (col: string) => editable && !!onCellEdit && !isPk(col);
  const hasActionsColumn = editable || !!onInsertRow;

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

  const handleCopyCSV = () =>
    triggerCopy('csv', toCSV(columns, rows));

  const handleCopyJSON = () =>
    triggerCopy('json', toJSON(columns, rows));

  // ── Cell editing ──

  const startCellEdit = (rowIdx: number, col: string, val: unknown) => {
    setEditingCell({ row: rowIdx, col });
    setEditValue(val === null || val === undefined ? '' : String(val));
    setCellError(null);
  };

  const cancelCellEdit = () => {
    setEditingCell(null);
    setCellError(null);
  };

  const commitCellEdit = async (col: string, row: Record<string, unknown>) => {
    if (!onCellEdit) return;
    const currentVal = row[col];
    const currentStr = currentVal === null || currentVal === undefined ? '' : String(currentVal);
    if (editValue === currentStr) {
      cancelCellEdit();
      return;
    }
    setSavingCell(true);
    setCellError(null);
    try {
      await onCellEdit(row, col, editValue);
      setEditingCell(null);
    } catch (e) {
      setCellError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSavingCell(false);
    }
  };

  // ── Row deletion ──

  const commitDeleteRow = async (row: Record<string, unknown>) => {
    if (!onDeleteRow) return;
    setDeletingRow(true);
    setRowActionError(null);
    try {
      await onDeleteRow(row);
      setConfirmDeleteRow(null);
    } catch (e) {
      setRowActionError(e instanceof Error ? e.message : 'Failed to delete row');
    } finally {
      setDeletingRow(false);
    }
  };

  // ── Row insertion ──

  const cancelAddRow = () => {
    setShowAddRow(false);
    setNewRowValues({});
  };

  const commitAddRow = async () => {
    if (!onInsertRow) return;
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(newRowValues)) {
      if (v !== '') values[k] = v;
    }
    setSavingNewRow(true);
    setRowActionError(null);
    try {
      await onInsertRow(values);
      cancelAddRow();
    } catch (e) {
      setRowActionError(e instanceof Error ? e.message : 'Failed to add row');
    } finally {
      setSavingNewRow(false);
    }
  };

  return (
    <div className="table-browser">
      {rowActionError && (
        <div className="filter-error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {rowActionError}
          <button className="filter-error-dismiss" onClick={() => setRowActionError(null)}>×</button>
        </div>
      )}

      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  className={onSort ? 'sortable-th' : ''}
                  onClick={onSort ? () => onSort(col) : undefined}
                  title={isPk(col) ? 'Primary key' : undefined}
                >
                  {col}
                  {isPk(col) && <span className="pk-badge">PK</span>}
                  {onSort && (
                    <span className="sort-arrow">
                      {sortColumn === col ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅'}
                    </span>
                  )}
                </th>
              ))}
              {hasActionsColumn && <th className="actions-th" />}
            </tr>
          </thead>
          <tbody>
            {showAddRow && (
              <tr className="add-row-form-row">
                {columns.map((col) => {
                  const def = columnDefs?.find((c) => c.name === col);
                  return (
                    <td key={col}>
                      <input
                        className="add-row-input"
                        placeholder={def?.pk ? '(auto)' : def?.type || ''}
                        value={newRowValues[col] ?? ''}
                        disabled={savingNewRow}
                        onChange={(e) => setNewRowValues((prev) => ({ ...prev, [col]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitAddRow();
                          if (e.key === 'Escape') cancelAddRow();
                        }}
                      />
                    </td>
                  );
                })}
                <td className="row-actions-cell">
                  <button className="row-action-btn row-action-confirm" disabled={savingNewRow} onClick={commitAddRow} title="Save new row">
                    ✓
                  </button>
                  <button className="row-action-btn" disabled={savingNewRow} onClick={cancelAddRow} title="Cancel">
                    ✕
                  </button>
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => {
                  const val = row[col];
                  const isNull = val === null || val === undefined;
                  const isEditing = editingCell?.row === i && editingCell.col === col;
                  const editable_ = canEditCell(col);

                  if (isEditing) {
                    return (
                      <td key={col} className="editing-cell">
                        <input
                          className="cell-edit-input"
                          autoFocus
                          value={editValue}
                          disabled={savingCell}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); void commitCellEdit(col, row); }
                            if (e.key === 'Escape') cancelCellEdit();
                          }}
                          onBlur={() => { if (!savingCell) cancelCellEdit(); }}
                        />
                        {cellError && <div className="cell-edit-error">{cellError}</div>}
                      </td>
                    );
                  }
                  return (
                    <td
                      key={col}
                      className={`${isNull ? 'null-value' : ''}${editable_ ? ' editable-cell' : ''}`}
                      title={editable_ ? 'Double-click to edit' : isPk(col) ? 'Primary key — read only' : undefined}
                      onDoubleClick={editable_ ? () => startCellEdit(i, col, val) : undefined}
                    >
                      {isNull ? 'NULL' : String(val)}
                    </td>
                  );
                })}
                {hasActionsColumn && (
                  <td className="row-actions-cell">
                    {!editable || !onDeleteRow ? null : confirmDeleteRow === i ? (
                      <span className="row-delete-confirm">
                        <button
                          className="row-action-btn row-action-confirm"
                          disabled={deletingRow}
                          onClick={() => commitDeleteRow(row)}
                          title="Confirm delete"
                        >
                          ✓
                        </button>
                        <button
                          className="row-action-btn"
                          disabled={deletingRow}
                          onClick={() => setConfirmDeleteRow(null)}
                          title="Cancel"
                        >
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button
                        className="row-action-btn row-action-delete"
                        onClick={() => setConfirmDeleteRow(i)}
                        title="Delete row"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-footer">
        <div className="table-footer-left">
          {onInsertRow && (
            <button
              className={`btn btn-sm${showAddRow ? ' active' : ''}`}
              onClick={() => (showAddRow ? cancelAddRow() : setShowAddRow(true))}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
