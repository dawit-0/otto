import { useState, useRef } from 'react';
import { type Column } from '../api';

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
  /** Column(s) that uniquely identify a row. Non-null enables row editing. */
  rowIdColumns?: string[] | null;
  /** Column metadata, used to build the "add row" form. */
  columnDefs?: Column[];
  onUpdateCell?: (rowId: Record<string, unknown>, column: string, value: string | null) => Promise<void>;
  onDeleteRow?: (rowId: Record<string, unknown>) => Promise<void>;
  onAddRow?: (values: Record<string, unknown>) => Promise<void>;
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
  rowIdColumns, columnDefs, onUpdateCell, onDeleteRow, onAddRow,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editable = Boolean(rowIdColumns && rowIdColumns.length > 0);

  // ── Cell editing ──
  const skipBlurCommit = useRef(false);
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; column: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editIsNull, setEditIsNull] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingCell, setSavingCell] = useState(false);

  // ── Row delete ──
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ index: number; message: string } | null>(null);

  // ── Add row ──
  const [addingRow, setAddingRow] = useState(false);
  const [newRowValues, setNewRowValues] = useState<Record<string, string>>({});
  const [newRowNulls, setNewRowNulls] = useState<Record<string, boolean>>({});
  const [addRowError, setAddRowError] = useState<string | null>(null);
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

  const getRowId = (row: Record<string, unknown>): Record<string, unknown> => {
    const id: Record<string, unknown> = {};
    (rowIdColumns ?? []).forEach((c) => { id[c] = row[c]; });
    return id;
  };

  // ── Cell editing handlers ──

  const startEdit = (rowIndex: number, column: string, value: unknown) => {
    if (!editable || !onUpdateCell || addingRow) return;
    setEditingCell({ rowIndex, column });
    const isNull = value === null || value === undefined;
    setEditIsNull(isNull);
    setEditValue(isNull ? '' : String(value));
    setEditError(null);
  };

  const cancelEdit = () => {
    skipBlurCommit.current = true;
    setEditingCell(null);
    setEditError(null);
  };

  const handleCellBlur = () => {
    if (skipBlurCommit.current) {
      skipBlurCommit.current = false;
      return;
    }
    void commitEdit();
  };

  const commitEdit = async () => {
    if (!editingCell || !onUpdateCell) return;
    const row = rows[editingCell.rowIndex];
    const oldVal = row[editingCell.column];
    const oldIsNull = oldVal === null || oldVal === undefined;
    const unchanged = editIsNull === oldIsNull && (editIsNull || editValue === String(oldVal));
    if (unchanged) {
      setEditingCell(null);
      return;
    }
    setSavingCell(true);
    setEditError(null);
    try {
      await onUpdateCell(getRowId(row), editingCell.column, editIsNull ? null : editValue);
      setEditingCell(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSavingCell(false);
    }
  };

  // ── Row delete handlers ──

  const handleDeleteClick = (rowIndex: number) => {
    if (confirmDeleteIndex === rowIndex) {
      void doDelete(rowIndex);
    } else {
      setConfirmDeleteIndex(rowIndex);
      setRowError(null);
    }
  };

  const doDelete = async (rowIndex: number) => {
    if (!onDeleteRow) return;
    setDeletingIndex(rowIndex);
    setRowError(null);
    try {
      await onDeleteRow(getRowId(rows[rowIndex]));
      setConfirmDeleteIndex(null);
    } catch (e) {
      setRowError({ index: rowIndex, message: e instanceof Error ? e.message : 'Delete failed' });
      setConfirmDeleteIndex(null);
    } finally {
      setDeletingIndex(null);
    }
  };

  // ── Add row handlers ──

  const openAddRow = () => {
    setAddingRow(true);
    setNewRowValues({});
    setNewRowNulls({});
    setAddRowError(null);
  };

  const closeAddRow = () => {
    setAddingRow(false);
    setNewRowValues({});
    setNewRowNulls({});
    setAddRowError(null);
  };

  const handleSaveNewRow = async () => {
    if (!onAddRow) return;
    const values: Record<string, unknown> = {};
    for (const col of columns) {
      if (newRowNulls[col]) {
        values[col] = null;
      } else if (newRowValues[col] !== undefined && newRowValues[col] !== '') {
        values[col] = newRowValues[col];
      }
    }
    setSavingNewRow(true);
    setAddRowError(null);
    try {
      await onAddRow(values);
      closeAddRow();
    } catch (e) {
      setAddRowError(e instanceof Error ? e.message : 'Insert failed');
    } finally {
      setSavingNewRow(false);
    }
  };

  const colDefMap = new Map((columnDefs ?? []).map((c) => [c.name, c]));

  return (
    <div className="table-browser">
      {rowError && (
        <div className="filter-error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {rowError.message}
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
              {editable && <th className="row-actions-header" />}
            </tr>
          </thead>
          <tbody>
            {addingRow && (
              <tr className="add-row-row">
                {columns.map((col) => {
                  const def = colDefMap.get(col);
                  const isNull = !!newRowNulls[col];
                  return (
                    <td key={col}>
                      <div className="cell-edit-wrapper">
                        <input
                          className="cell-edit-input add-row-input"
                          type="text"
                          value={isNull ? '' : (newRowValues[col] ?? '')}
                          disabled={isNull}
                          placeholder={def?.notnull && !def?.default ? 'required' : 'default'}
                          onChange={(e) => setNewRowValues((prev) => ({ ...prev, [col]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleSaveNewRow();
                            if (e.key === 'Escape') closeAddRow();
                          }}
                        />
                        {def && !def.notnull && (
                          <button
                            type="button"
                            className={`cell-null-toggle${isNull ? ' active' : ''}`}
                            title="Set to NULL"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => setNewRowNulls((prev) => ({ ...prev, [col]: !prev[col] }))}
                          >
                            ∅
                          </button>
                        )}
                      </div>
                    </td>
                  );
                })}
                <td className="row-actions-cell">
                  <button className="btn-icon" title="Save row" disabled={savingNewRow} onClick={() => void handleSaveNewRow()}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                  <button className="btn-icon" title="Cancel" disabled={savingNewRow} onClick={closeAddRow}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </td>
              </tr>
            )}
            {addingRow && addRowError && (
              <tr className="add-row-error-row">
                <td colSpan={columns.length + 1}>{addRowError}</td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => {
                  const val = row[col];
                  const isNull = val === null || val === undefined;
                  const isEditing = editingCell?.rowIndex === i && editingCell?.column === col;

                  if (isEditing) {
                    const def = colDefMap.get(col);
                    return (
                      <td key={col} className="cell-editing">
                        <div className="cell-edit-wrapper">
                          <input
                            className="cell-edit-input"
                            type="text"
                            autoFocus
                            value={editIsNull ? '' : editValue}
                            disabled={editIsNull || savingCell}
                            onChange={(e) => setEditValue(e.target.value)}
                            onFocus={(e) => e.target.select()}
                            onBlur={handleCellBlur}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); void commitEdit(); }
                              if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                            }}
                          />
                          {!def?.notnull && (
                            <button
                              type="button"
                              className={`cell-null-toggle${editIsNull ? ' active' : ''}`}
                              title="Set to NULL"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => setEditIsNull((v) => !v)}
                            >
                              ∅
                            </button>
                          )}
                        </div>
                        {editError && <div className="cell-edit-error">{editError}</div>}
                      </td>
                    );
                  }

                  return (
                    <td
                      key={col}
                      className={isNull ? 'null-value' : ''}
                      onDoubleClick={() => startEdit(i, col, val)}
                      title={editable ? 'Double-click to edit' : undefined}
                    >
                      {isNull ? 'NULL' : String(val)}
                    </td>
                  );
                })}
                {editable && (
                  <td className="row-actions-cell">
                    <button
                      className={`btn-icon row-delete-btn${confirmDeleteIndex === i ? ' confirm' : ''}`}
                      title={confirmDeleteIndex === i ? 'Click again to confirm delete' : 'Delete row'}
                      disabled={deletingIndex === i}
                      onClick={() => handleDeleteClick(i)}
                      onBlur={() => setConfirmDeleteIndex((c) => (c === i ? null : c))}
                    >
                      {confirmDeleteIndex === i ? (
                        'Confirm?'
                      ) : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
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
          {onAddRow && (
            <button
              className={`btn btn-sm${addingRow ? ' active' : ''}`}
              onClick={() => (addingRow ? closeAddRow() : openAddRow())}
              title="Insert a new row"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Row
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
