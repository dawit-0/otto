import { useState, useRef } from 'react';

export interface EditableColumn {
  name: string;
  type: string;
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
  /** Primary-key column names. Editing a row requires at least one. */
  pkColumns?: string[];
  /** Column metadata used to coerce typed (numeric) input values. */
  editableColumns?: EditableColumn[];
  onUpdateCell?: (pk: Record<string, unknown>, column: string, value: unknown) => Promise<void>;
  onDeleteRow?: (pk: Record<string, unknown>) => Promise<void>;
  onInsertRow?: (values: Record<string, unknown>) => Promise<void>;
}

const NUMERIC_TYPE_RE = /^(int|integer|bigint|smallint|tinyint|mediumint|real|float|double|numeric|decimal|number|serial|bigserial|float4|float8|int2|int4|int8)/i;

function coerceValue(raw: string, type: string | undefined): unknown {
  if (raw === '') return null;
  if (type && NUMERIC_TYPE_RE.test(type.trim())) {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
  }
  return raw;
}

function displayValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val);
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
  rowIndex: number;
  column: string;
  value: string;
}

export default function DataTable({
  columns, rows, total, limit = 100, offset = 0, onPageChange, exportFilename = 'export',
  sortColumn, sortDirection, onSort,
  pkColumns, editableColumns, onUpdateCell, onDeleteRow, onInsertRow,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [cellSaving, setCellSaving] = useState(false);
  const [cellError, setCellError] = useState<string | null>(null);
  const [deletingRow, setDeletingRow] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [draftRow, setDraftRow] = useState<Record<string, string> | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

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

  const colTypeMap: Record<string, string> = {};
  (editableColumns ?? []).forEach((c) => { colTypeMap[c.name] = c.type; });

  const canEditCells = !!onUpdateCell && !!pkColumns?.length;
  const canDeleteRows = !!onDeleteRow && !!pkColumns?.length;
  const canInsertRows = !!onInsertRow;

  const pkFor = (row: Record<string, unknown>): Record<string, unknown> => {
    const pk: Record<string, unknown> = {};
    (pkColumns ?? []).forEach((c) => { pk[c] = row[c]; });
    return pk;
  };

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

  const startEdit = (rowIndex: number, column: string, row: Record<string, unknown>) => {
    if (!canEditCells || draftRow) return;
    setCellError(null);
    setEditingCell({ rowIndex, column, value: displayValue(row[column]) });
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setCellError(null);
  };

  const commitEdit = async (row: Record<string, unknown>) => {
    if (!editingCell || !onUpdateCell) return;
    const { column, value } = editingCell;
    const coerced = coerceValue(value, colTypeMap[column]);
    if (coerced === (row[column] ?? null)) {
      setEditingCell(null);
      return;
    }
    setCellSaving(true);
    setCellError(null);
    try {
      await onUpdateCell(pkFor(row), column, coerced);
      setEditingCell(null);
    } catch (e) {
      setCellError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setCellSaving(false);
    }
  };

  const handleDelete = async (row: Record<string, unknown>, rowIndex: number) => {
    if (!onDeleteRow) return;
    if (!window.confirm('Delete this row? This cannot be undone.')) return;
    setDeletingRow(rowIndex);
    setRowError(null);
    try {
      await onDeleteRow(pkFor(row));
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingRow(null);
    }
  };

  const startAddRow = () => {
    if (!canInsertRows) return;
    setEditingCell(null);
    setDraftError(null);
    const blank: Record<string, string> = {};
    columns.forEach((c) => { blank[c] = ''; });
    setDraftRow(blank);
  };

  const cancelAddRow = () => {
    setDraftRow(null);
    setDraftError(null);
  };

  const commitAddRow = async () => {
    if (!draftRow || !onInsertRow) return;
    const values: Record<string, unknown> = {};
    columns.forEach((c) => { values[c] = coerceValue(draftRow[c], colTypeMap[c]); });
    setDraftSaving(true);
    setDraftError(null);
    try {
      await onInsertRow(values);
      setDraftRow(null);
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'Insert failed');
    } finally {
      setDraftSaving(false);
    }
  };

  return (
    <div className="table-browser">
      {canInsertRows && (
        <div className="data-table-edit-toolbar">
          <button className="btn btn-sm" onClick={startAddRow} disabled={!!draftRow}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add row
          </button>
          {rowError && <span className="data-table-row-error">{rowError}</span>}
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
                  {onSort && (
                    <span className="sort-arrow">
                      {sortColumn === col ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅'}
                    </span>
                  )}
                </th>
              ))}
              {canDeleteRows && <th className="data-table-actions-th" />}
            </tr>
          </thead>
          <tbody>
            {draftRow && (
              <tr className="data-table-draft-row">
                {columns.map((col) => (
                  <td key={col}>
                    <input
                      className="cell-edit-input"
                      autoFocus={col === columns[0]}
                      value={draftRow[col]}
                      placeholder={colTypeMap[col] || ''}
                      disabled={draftSaving}
                      onChange={(e) => setDraftRow({ ...draftRow, [col]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitAddRow();
                        if (e.key === 'Escape') cancelAddRow();
                      }}
                    />
                  </td>
                ))}
                {canDeleteRows && (
                  <td className="data-table-actions-td">
                    <button className="btn-icon" title="Save" onClick={commitAddRow} disabled={draftSaving}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                    <button className="btn-icon" title="Cancel" onClick={cancelAddRow} disabled={draftSaving}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </td>
                )}
              </tr>
            )}
            {draftRow && draftError && (
              <tr className="data-table-draft-error-row">
                <td colSpan={columns.length + (canDeleteRows ? 1 : 0)} className="data-table-draft-error">
                  {draftError}
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => {
                  const val = row[col];
                  const isNull = val === null || val === undefined;
                  const isEditing = editingCell?.rowIndex === i && editingCell.column === col;

                  if (isEditing) {
                    return (
                      <td key={col} className="cell-editing">
                        <input
                          className="cell-edit-input"
                          autoFocus
                          value={editingCell.value}
                          disabled={cellSaving}
                          onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                          onBlur={() => commitEdit(row)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit(row);
                            if (e.key === 'Escape') cancelEdit();
                          }}
                        />
                        {cellError && <div className="cell-edit-error">{cellError}</div>}
                      </td>
                    );
                  }
                  return (
                    <td
                      key={col}
                      className={`${isNull ? 'null-value' : ''}${canEditCells ? ' editable-cell' : ''}`}
                      onDoubleClick={canEditCells ? () => startEdit(i, col, row) : undefined}
                      title={canEditCells ? 'Double-click to edit' : undefined}
                    >
                      {isNull ? 'NULL' : String(val)}
                    </td>
                  );
                })}
                {canDeleteRows && (
                  <td className="data-table-actions-td">
                    <button
                      className="btn-icon"
                      title="Delete row"
                      disabled={deletingRow === i}
                      onClick={() => handleDelete(row, i)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
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
