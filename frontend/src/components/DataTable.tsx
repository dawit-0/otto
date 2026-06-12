import { useState, useRef, Fragment } from 'react';
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
  columnDefs?: Column[];
  onCellEdit?: (pk: Record<string, unknown>, column: string, value: unknown) => Promise<void>;
  onDeleteRow?: (pk: Record<string, unknown>) => Promise<void>;
  onAddRow?: (values: Record<string, unknown>) => Promise<void>;
}

const NUMERIC_TYPE_RE = /^(int|integer|bigint|smallint|tinyint|mediumint|real|float|double|numeric|decimal|number|serial|bigserial|float4|float8|int2|int4|int8)/i;

function isNumericType(type: string): boolean {
  return NUMERIC_TYPE_RE.test(type.trim());
}

function isBooleanType(type: string): boolean {
  const t = type.trim().toLowerCase();
  return t === 'boolean' || t === 'bool';
}

function coerceValue(raw: string, colDef?: Column): unknown {
  if (colDef && isBooleanType(colDef.type)) {
    return raw === 'true' ? true : raw === 'false' ? false : null;
  }
  if (colDef && isNumericType(colDef.type)) {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  return raw;
}

function valueToEditString(val: unknown, colDef?: Column): string {
  if (val === null || val === undefined) return '';
  if (colDef && isBooleanType(colDef.type)) {
    return val === true || val === 1 || val === '1' || val === 't' ? 'true' : 'false';
  }
  return String(val);
}

function getPk(row: Record<string, unknown>, pkColumns: string[]): Record<string, unknown> {
  const pk: Record<string, unknown> = {};
  for (const col of pkColumns) pk[col] = row[col];
  return pk;
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
  columns, rows, total, limit = 100, offset = 0, onPageChange, exportFilename = 'export',
  sortColumn, sortDirection, onSort,
  columnDefs, onCellEdit, onDeleteRow, onAddRow,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingCell, setEditingCell] = useState<{ rowIndex: number; column: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingCell, setSavingCell] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<number | null>(null);
  const [deletingRow, setDeletingRow] = useState<number | null>(null);

  const [addingRow, setAddingRow] = useState(false);
  const [newRowValues, setNewRowValues] = useState<Record<string, string>>({});
  const [newRowNulls, setNewRowNulls] = useState<Record<string, boolean>>({});
  const [savingNewRow, setSavingNewRow] = useState(false);
  const [addRowError, setAddRowError] = useState<string | null>(null);

  if (columns.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">{'{ }'}</div>
        <div className="empty-state-title">No results</div>
        <div className="empty-state-text">Run a query to see results here.</div>
      </div>
    );
  }

  const colDefMap = new Map((columnDefs ?? []).map((c) => [c.name, c]));
  const pkColumns = (columnDefs ?? []).filter((c) => c.pk).map((c) => c.name);
  const canEditRows = !!(onCellEdit || onDeleteRow) && pkColumns.length > 0;
  const canAddRow = !!onAddRow;
  const hasActionsColumn = canEditRows || canAddRow;

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

  const startEdit = (rowIndex: number, col: string) => {
    if (!canEditRows) return;
    const row = rows[rowIndex];
    setEditingCell({ rowIndex, column: col });
    setEditValue(valueToEditString(row[col], colDefMap.get(col)));
    setRowErrors((prev) => {
      if (!(rowIndex in prev)) return prev;
      const next = { ...prev };
      delete next[rowIndex];
      return next;
    });
  };

  const cancelEdit = () => setEditingCell(null);

  const commitEdit = async () => {
    if (!editingCell || !onCellEdit) return;
    const { rowIndex, column } = editingCell;
    const row = rows[rowIndex];
    const colDef = colDefMap.get(column);
    if (editValue === valueToEditString(row[column], colDef)) {
      setEditingCell(null);
      return;
    }
    const value = coerceValue(editValue, colDef);
    const pk = getPk(row, pkColumns);
    setSavingCell(true);
    try {
      await onCellEdit(pk, column, value);
      setEditingCell(null);
    } catch (e) {
      setRowErrors((prev) => ({ ...prev, [rowIndex]: e instanceof Error ? e.message : 'Failed to save' }));
    } finally {
      setSavingCell(false);
    }
  };

  const setCellNull = async (rowIndex: number, column: string) => {
    if (!onCellEdit) return;
    const row = rows[rowIndex];
    const pk = getPk(row, pkColumns);
    setSavingCell(true);
    try {
      await onCellEdit(pk, column, null);
      setEditingCell(null);
    } catch (e) {
      setRowErrors((prev) => ({ ...prev, [rowIndex]: e instanceof Error ? e.message : 'Failed to save' }));
    } finally {
      setSavingCell(false);
    }
  };

  // ── Row deletion ──

  const handleDeleteRow = async (rowIndex: number) => {
    if (!onDeleteRow) return;
    const row = rows[rowIndex];
    const pk = getPk(row, pkColumns);
    setDeletingRow(rowIndex);
    try {
      await onDeleteRow(pk);
      setConfirmDeleteRow(null);
    } catch (e) {
      setRowErrors((prev) => ({ ...prev, [rowIndex]: e instanceof Error ? e.message : 'Failed to delete' }));
    } finally {
      setDeletingRow(null);
    }
  };

  // ── Add row ──

  const openAddRow = () => {
    setNewRowValues({});
    setNewRowNulls({});
    setAddRowError(null);
    setAddingRow(true);
  };

  const cancelAddRow = () => {
    setAddingRow(false);
    setAddRowError(null);
  };

  const commitAddRow = async () => {
    if (!onAddRow) return;
    const values: Record<string, unknown> = {};
    for (const col of columns) {
      if (newRowNulls[col]) {
        values[col] = null;
        continue;
      }
      const raw = newRowValues[col];
      if (raw === undefined || raw === '') continue;
      values[col] = coerceValue(raw, colDefMap.get(col));
    }
    setSavingNewRow(true);
    setAddRowError(null);
    try {
      await onAddRow(values);
      setAddingRow(false);
      setNewRowValues({});
      setNewRowNulls({});
    } catch (e) {
      setAddRowError(e instanceof Error ? e.message : 'Failed to add row');
    } finally {
      setSavingNewRow(false);
    }
  };

  const renderEditor = (rowIndex: number, col: string) => {
    const colDef = colDefMap.get(col);
    if (colDef && isBooleanType(colDef.type)) {
      return (
        <select
          autoFocus
          value={editValue}
          disabled={savingCell}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') cancelEdit();
          }}
          className="cell-edit-select"
        >
          <option value="true">true</option>
          <option value="false">false</option>
          <option value="">NULL</option>
        </select>
      );
    }
    return (
      <div className="cell-edit-wrapper">
        <input
          autoFocus
          type={colDef && isNumericType(colDef.type) ? 'number' : 'text'}
          value={editValue}
          disabled={savingCell}
          onChange={(e) => setEditValue(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
            if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
          }}
          className="cell-edit-input"
        />
        <button
          type="button"
          className="cell-null-btn"
          title="Set to NULL"
          tabIndex={-1}
          disabled={savingCell}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setCellNull(rowIndex, col)}
        >
          &empty;
        </button>
      </div>
    );
  };

  return (
    <div className="table-browser">
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
                  {colDefMap.get(col)?.pk && <span className="pk-badge" title="Primary key">PK</span>}
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
            {addingRow && (
              <>
                <tr className="add-row-form">
                  {columns.map((col) => {
                    const colDef = colDefMap.get(col);
                    const isNull = !!newRowNulls[col];
                    return (
                      <td key={col}>
                        <div className="cell-edit-wrapper">
                          <input
                            type={colDef && isNumericType(colDef.type) ? 'number' : 'text'}
                            placeholder={colDef?.pk ? 'auto' : colDef?.default ? `default: ${colDef.default}` : ''}
                            value={isNull ? '' : (newRowValues[col] ?? '')}
                            disabled={isNull || savingNewRow}
                            onChange={(e) => setNewRowValues((prev) => ({ ...prev, [col]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitAddRow();
                              if (e.key === 'Escape') cancelAddRow();
                            }}
                            className="cell-edit-input"
                          />
                          <button
                            type="button"
                            className={`cell-null-btn${isNull ? ' active' : ''}`}
                            title="Set to NULL"
                            disabled={savingNewRow}
                            onClick={() => setNewRowNulls((prev) => ({ ...prev, [col]: !prev[col] }))}
                          >
                            &empty;
                          </button>
                        </div>
                      </td>
                    );
                  })}
                  <td className="actions-cell">
                    <button className="btn btn-sm btn-primary" onClick={commitAddRow} disabled={savingNewRow}>
                      {savingNewRow ? 'Saving…' : 'Save'}
                    </button>
                    <button className="btn btn-sm" onClick={cancelAddRow} disabled={savingNewRow}>
                      Cancel
                    </button>
                  </td>
                </tr>
                {addRowError && (
                  <tr className="row-error-row">
                    <td colSpan={columns.length + (hasActionsColumn ? 1 : 0)}>{addRowError}</td>
                  </tr>
                )}
              </>
            )}
            {rows.map((row, i) => (
              <Fragment key={i}>
                <tr>
                  {columns.map((col) => {
                    const val = row[col];
                    const isNull = val === null || val === undefined;
                    const isEditingThis = editingCell?.rowIndex === i && editingCell.column === col;
                    return (
                      <td
                        key={col}
                        className={`${isNull ? 'null-value' : ''}${isEditingThis ? ' editing-cell' : ''}${canEditRows ? ' editable-cell' : ''}`}
                        onDoubleClick={canEditRows && !isEditingThis ? () => startEdit(i, col) : undefined}
                        title={canEditRows && !isEditingThis ? 'Double-click to edit' : undefined}
                      >
                        {isEditingThis ? renderEditor(i, col) : (isNull ? 'NULL' : String(val))}
                      </td>
                    );
                  })}
                  {hasActionsColumn && (
                    <td className="actions-cell">
                      {canEditRows && (
                        confirmDeleteRow === i ? (
                          <span className="confirm-delete">
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => handleDeleteRow(i)}
                              disabled={deletingRow === i}
                            >
                              {deletingRow === i ? '…' : 'Confirm'}
                            </button>
                            <button
                              className="btn btn-sm"
                              onClick={() => setConfirmDeleteRow(null)}
                              disabled={deletingRow === i}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            className="btn-icon row-delete-btn"
                            title="Delete row"
                            onClick={() => setConfirmDeleteRow(i)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                            </svg>
                          </button>
                        )
                      )}
                    </td>
                  )}
                </tr>
                {rowErrors[i] && (
                  <tr className="row-error-row">
                    <td colSpan={columns.length + (hasActionsColumn ? 1 : 0)}>{rowErrors[i]}</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-footer">
        <div className="table-footer-left">
          {canAddRow && (
            <button className="btn btn-sm btn-primary" onClick={openAddRow} disabled={addingRow}>
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
