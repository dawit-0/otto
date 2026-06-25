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
  /** Enables inline editing. Only meaningful when the table has a primary key. */
  editable?: boolean;
  primaryKey?: string[];
  columnDefs?: Column[];
  onCellEdit?: (pk: Record<string, unknown>, column: string, value: unknown) => Promise<void>;
  onInsertRow?: (values: Record<string, unknown>) => Promise<void>;
  onDeleteRow?: (pk: Record<string, unknown>) => Promise<void>;
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

function isNumericColumn(type: string | undefined): boolean {
  if (!type) return false;
  const base = type.toLowerCase().split('(')[0].trim().split(' ')[0];
  return ['int', 'integer', 'bigint', 'smallint', 'tinyint', 'mediumint', 'real', 'float',
    'double', 'numeric', 'decimal', 'number', 'serial', 'bigserial', 'float4', 'float8',
    'int2', 'int4', 'int8'].includes(base);
}

function coerceValue(raw: string, wasNumeric: boolean): unknown {
  if (raw === '') return null;
  if (wasNumeric) {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
  }
  return raw;
}

function pkFromRow(row: Record<string, unknown>, primaryKey: string[]): Record<string, unknown> {
  const pk: Record<string, unknown> = {};
  primaryKey.forEach((col) => { pk[col] = row[col]; });
  return pk;
}

export default function DataTable({
  columns, rows, total, limit = 100, offset = 0, onPageChange, exportFilename = 'export',
  sortColumn, sortDirection, onSort,
  editable = false, primaryKey = [], columnDefs = [], onCellEdit, onInsertRow, onDeleteRow,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingCell, setEditingCell] = useState<{ rowIndex: number; column: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingCell, setSavingCell] = useState(false);
  const [cellError, setCellError] = useState<string | null>(null);

  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);
  const confirmTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  const [addingRow, setAddingRow] = useState(false);
  const [newRowValues, setNewRowValues] = useState<Record<string, string>>({});
  const [savingNewRow, setSavingNewRow] = useState(false);
  const [addRowError, setAddRowError] = useState<string | null>(null);

  const canEdit = editable && primaryKey.length > 0;

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

  const handleCopyCSV = () =>
    triggerCopy('csv', toCSV(columns, rows));

  const handleCopyJSON = () =>
    triggerCopy('json', toJSON(columns, rows));

  const columnType = (col: string) => columnDefs.find((c) => c.name === col)?.type;

  const startEdit = (rowIndex: number, col: string, currentValue: unknown) => {
    if (!canEdit || primaryKey.includes(col) || savingCell) return;
    setCellError(null);
    setEditingCell({ rowIndex, column: col });
    setEditValue(currentValue === null || currentValue === undefined ? '' : String(currentValue));
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const commitEdit = async () => {
    if (!editingCell || !onCellEdit) return;
    const row = rows[editingCell.rowIndex];
    const original = row[editingCell.column];
    const originalStr = original === null || original === undefined ? '' : String(original);
    if (editValue === originalStr) {
      cancelEdit();
      return;
    }
    const wasNumeric = typeof original === 'number' || isNumericColumn(columnType(editingCell.column));
    const value = coerceValue(editValue, wasNumeric);
    const pk = pkFromRow(row, primaryKey);
    setSavingCell(true);
    setCellError(null);
    try {
      await onCellEdit(pk, editingCell.column, value);
      setEditingCell(null);
      setEditValue('');
    } catch (e) {
      setCellError(e instanceof Error ? e.message : 'Failed to save change');
    } finally {
      setSavingCell(false);
    }
  };

  const handleDeleteClick = (rowIndex: number) => {
    if (confirmDeleteIndex === rowIndex) {
      if (confirmTimeout.current) clearTimeout(confirmTimeout.current);
      void performDelete(rowIndex);
      return;
    }
    setConfirmDeleteIndex(rowIndex);
    if (confirmTimeout.current) clearTimeout(confirmTimeout.current);
    confirmTimeout.current = setTimeout(() => setConfirmDeleteIndex(null), 3000);
  };

  const performDelete = async (rowIndex: number) => {
    if (!onDeleteRow) return;
    setDeletingIndex(rowIndex);
    setConfirmDeleteIndex(null);
    try {
      await onDeleteRow(pkFromRow(rows[rowIndex], primaryKey));
    } catch (e) {
      setCellError(e instanceof Error ? e.message : 'Failed to delete row');
    } finally {
      setDeletingIndex(null);
    }
  };

  const openAddRow = () => {
    setNewRowValues({});
    setAddRowError(null);
    setAddingRow(true);
  };

  const cancelAddRow = () => {
    setAddingRow(false);
    setNewRowValues({});
    setAddRowError(null);
  };

  const commitAddRow = async () => {
    if (!onInsertRow) return;
    const values: Record<string, unknown> = {};
    for (const col of columns) {
      const raw = newRowValues[col];
      if (raw === undefined || raw === '') continue; // omit blanks so DB defaults/autoincrement apply
      values[col] = coerceValue(raw, isNumericColumn(columnType(col)));
    }
    setSavingNewRow(true);
    setAddRowError(null);
    try {
      await onInsertRow(values);
      cancelAddRow();
    } catch (e) {
      setAddRowError(e instanceof Error ? e.message : 'Failed to add row');
    } finally {
      setSavingNewRow(false);
    }
  };

  return (
    <div className="table-browser">
      {cellError && (
        <div className="filter-error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {cellError}
          <button className="filter-chip-remove" onClick={() => setCellError(null)} title="Dismiss">×</button>
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
                >
                  {col}
                  {primaryKey.includes(col) && (
                    <span className="pk-indicator" title="Primary key">🔑</span>
                  )}
                  {onSort && (
                    <span className="sort-arrow">
                      {sortColumn === col ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅'}
                    </span>
                  )}
                </th>
              ))}
              {canEdit && <th className="row-actions-th" />}
            </tr>
          </thead>
          <tbody>
            {addingRow && (
              <tr className="new-row-form">
                {columns.map((col) => (
                  <td key={col}>
                    <input
                      className="cell-edit-input"
                      type={isNumericColumn(columnType(col)) ? 'number' : 'text'}
                      placeholder={primaryKey.includes(col) ? 'auto' : col}
                      value={newRowValues[col] ?? ''}
                      onChange={(e) => setNewRowValues((prev) => ({ ...prev, [col]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitAddRow();
                        if (e.key === 'Escape') cancelAddRow();
                      }}
                      disabled={savingNewRow}
                      autoFocus={col === columns[0]}
                    />
                  </td>
                ))}
                <td className="row-actions-td">
                  <button className="btn btn-sm btn-primary" onClick={commitAddRow} disabled={savingNewRow}>
                    Save
                  </button>
                  <button className="btn btn-sm" onClick={cancelAddRow} disabled={savingNewRow}>
                    Cancel
                  </button>
                </td>
              </tr>
            )}
            {addingRow && addRowError && (
              <tr className="new-row-error-row">
                <td colSpan={columns.length + 1} className="filter-error">{addRowError}</td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i} className={deletingIndex === i ? 'row-deleting' : ''}>
                {columns.map((col) => {
                  const val = row[col];
                  const isNull = val === null || val === undefined;
                  const isEditing = editingCell?.rowIndex === i && editingCell.column === col;
                  const isEditableCell = canEdit && !primaryKey.includes(col);

                  if (isEditing) {
                    return (
                      <td key={col} className="cell-editing">
                        <input
                          className="cell-edit-input"
                          autoFocus
                          value={editValue}
                          disabled={savingCell}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit();
                            if (e.key === 'Escape') cancelEdit();
                          }}
                        />
                      </td>
                    );
                  }

                  return (
                    <td
                      key={col}
                      className={`${isNull ? 'null-value' : ''}${isEditableCell ? ' editable-cell' : ''}`}
                      onDoubleClick={() => startEdit(i, col, val)}
                      title={isEditableCell ? 'Double-click to edit' : undefined}
                    >
                      {isNull ? 'NULL' : String(val)}
                    </td>
                  );
                })}
                {canEdit && (
                  <td className="row-actions-td">
                    <button
                      className={`btn-icon row-delete-btn${confirmDeleteIndex === i ? ' confirm-delete' : ''}`}
                      onClick={() => handleDeleteClick(i)}
                      disabled={deletingIndex === i}
                      title={confirmDeleteIndex === i ? 'Click again to confirm delete' : 'Delete row'}
                    >
                      {confirmDeleteIndex === i ? 'Confirm?' : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                          <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      )}
                    </button>
                  </td>
                )}
              </tr>
            ))}
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
          {canEdit && (
            <button className="btn btn-sm" onClick={openAddRow} disabled={addingRow} title="Insert a new row">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add row
            </button>
          )}
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
