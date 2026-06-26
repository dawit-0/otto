import { Fragment, useState, useRef } from 'react';
import { api, type Column } from '../api';

export interface EditableConfig {
  dbId: string;
  tableName: string;
  columnDefs: Column[];
  /** Called after a successful insert/update/delete so the caller can refetch. */
  onChanged: () => void;
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
  editable?: EditableConfig;
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

function displayValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val);
}

export default function DataTable({ columns, rows, total, limit = 100, offset = 0, onPageChange, exportFilename = 'export', sortColumn, sortDirection, onSort, editable }: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingCell, setEditingCell] = useState<{ rowIndex: number; col: string } | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [cellBusy, setCellBusy] = useState(false);
  const [cellError, setCellError] = useState<{ rowIndex: number; col: string; message: string } | null>(null);

  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);
  const [deleteBusyIndex, setDeleteBusyIndex] = useState<number | null>(null);
  const confirmTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [addingRow, setAddingRow] = useState(false);
  const [newRowDraft, setNewRowDraft] = useState<Record<string, string>>({});
  const [newRowBusy, setNewRowBusy] = useState(false);
  const [newRowError, setNewRowError] = useState<string | null>(null);

  const pkColumns = editable ? editable.columnDefs.filter((c) => c.pk).map((c) => c.name) : [];
  const canMutateRows = !!editable && pkColumns.length > 0;

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

  const startEdit = (rowIndex: number, col: string, value: unknown) => {
    if (!canMutateRows || pkColumns.includes(col)) return;
    setCellError(null);
    setEditingCell({ rowIndex, col });
    setEditDraft(displayValue(value));
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditDraft('');
  };

  const commitEdit = async () => {
    if (!editingCell || !editable) return;
    const { rowIndex, col } = editingCell;
    const row = rows[rowIndex];
    const original = displayValue(row[col]);
    if (editDraft === original) {
      cancelEdit();
      return;
    }
    const pk = Object.fromEntries(pkColumns.map((c) => [c, row[c]]));
    setCellBusy(true);
    try {
      await api.updateRow(editable.dbId, editable.tableName, pk, { [col]: editDraft });
      setEditingCell(null);
      setEditDraft('');
      editable.onChanged();
    } catch (e) {
      setCellError({ rowIndex, col, message: e instanceof Error ? e.message : 'Update failed' });
    } finally {
      setCellBusy(false);
    }
  };

  const handleDeleteClick = (rowIndex: number) => {
    if (confirmDeleteIndex !== rowIndex) {
      setConfirmDeleteIndex(rowIndex);
      if (confirmTimeout.current) clearTimeout(confirmTimeout.current);
      confirmTimeout.current = setTimeout(() => setConfirmDeleteIndex(null), 3000);
      return;
    }
    if (confirmTimeout.current) clearTimeout(confirmTimeout.current);
    setConfirmDeleteIndex(null);
    void deleteRow(rowIndex);
  };

  const deleteRow = async (rowIndex: number) => {
    if (!editable) return;
    const row = rows[rowIndex];
    const pk = Object.fromEntries(pkColumns.map((c) => [c, row[c]]));
    setDeleteBusyIndex(rowIndex);
    try {
      await api.deleteRow(editable.dbId, editable.tableName, pk);
      editable.onChanged();
    } catch (e) {
      setCellError({ rowIndex, col: columns[0], message: e instanceof Error ? e.message : 'Delete failed' });
    } finally {
      setDeleteBusyIndex(null);
    }
  };

  const openAddRow = () => {
    setNewRowError(null);
    setNewRowDraft({});
    setAddingRow(true);
  };

  const cancelAddRow = () => {
    setAddingRow(false);
    setNewRowDraft({});
    setNewRowError(null);
  };

  const commitAddRow = async () => {
    if (!editable) return;
    setNewRowBusy(true);
    setNewRowError(null);
    try {
      await api.insertRow(editable.dbId, editable.tableName, newRowDraft);
      setAddingRow(false);
      setNewRowDraft({});
      editable.onChanged();
    } catch (e) {
      setNewRowError(e instanceof Error ? e.message : 'Insert failed');
    } finally {
      setNewRowBusy(false);
    }
  };

  return (
    <div className="table-browser">
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              {editable && <th className="data-table-actions-th" />}
              {columns.map((col) => (
                <th
                  key={col}
                  className={onSort ? 'sortable-th' : ''}
                  onClick={onSort ? () => onSort(col) : undefined}
                >
                  {col}
                  {pkColumns.includes(col) && <span className="pk-badge" title="Primary key">key</span>}
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
            {addingRow && editable && (
              <tr className="add-row-row">
                <td className="data-table-actions-cell">
                  <button className="btn-icon" onClick={cancelAddRow} title="Cancel" disabled={newRowBusy}>✕</button>
                </td>
                {columns.map((col) => (
                  <td key={col}>
                    <input
                      className="cell-edit-input"
                      placeholder={editable.columnDefs.find((c) => c.name === col)?.default ?? (pkColumns.includes(col) ? 'required' : 'NULL')}
                      value={newRowDraft[col] ?? ''}
                      onChange={(e) => setNewRowDraft((prev) => ({ ...prev, [col]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitAddRow();
                        if (e.key === 'Escape') cancelAddRow();
                      }}
                      disabled={newRowBusy}
                    />
                  </td>
                ))}
              </tr>
            )}
            {addingRow && newRowError && (
              <tr className="add-row-error-row">
                <td colSpan={columns.length + 1} className="cell-error-text">
                  {newRowError}
                </td>
              </tr>
            )}
            {addingRow && (
              <tr className="add-row-submit-row">
                <td colSpan={columns.length + 1}>
                  <button className="btn btn-sm btn-primary" onClick={commitAddRow} disabled={newRowBusy}>
                    {newRowBusy ? 'Saving…' : 'Save row'}
                  </button>
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <Fragment key={i}>
                <tr>
                  {editable && (
                    <td className="data-table-actions-cell">
                      {canMutateRows ? (
                        <button
                          className={`btn-icon btn-icon-danger${confirmDeleteIndex === i ? ' confirming' : ''}`}
                          onClick={() => handleDeleteClick(i)}
                          disabled={deleteBusyIndex === i}
                          title={confirmDeleteIndex === i ? 'Click again to confirm delete' : 'Delete row'}
                        >
                          {deleteBusyIndex === i ? '…' : confirmDeleteIndex === i ? 'confirm?' : '🗑'}
                        </button>
                      ) : (
                        <span className="row-readonly-dot" title="No primary key — row editing disabled">·</span>
                      )}
                    </td>
                  )}
                  {columns.map((col) => {
                    const val = row[col];
                    const isNull = val === null || val === undefined;
                    const isEditing = editingCell?.rowIndex === i && editingCell.col === col;
                    if (isEditing) {
                      return (
                        <td key={col} className="editing-cell">
                          <input
                            className="cell-edit-input"
                            autoFocus
                            value={editDraft}
                            disabled={cellBusy}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onBlur={() => void commitEdit()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void commitEdit();
                              if (e.key === 'Escape') cancelEdit();
                            }}
                          />
                        </td>
                      );
                    }
                    const editableCell = canMutateRows && !pkColumns.includes(col);
                    return (
                      <td
                        key={col}
                        className={`${isNull ? 'null-value' : ''}${editableCell ? ' editable-cell' : ''}`}
                        onDoubleClick={editableCell ? () => startEdit(i, col, val) : undefined}
                        title={editableCell ? 'Double-click to edit' : undefined}
                      >
                        {isNull ? 'NULL' : String(val)}
                      </td>
                    );
                  })}
                </tr>
                {cellError && cellError.rowIndex === i && (
                  <tr className="add-row-error-row">
                    <td colSpan={columns.length + (editable ? 1 : 0)} className="cell-error-text">
                      {cellError.message}
                    </td>
                  </tr>
                )}
              </Fragment>
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
          {editable && !addingRow && (
            <button className="btn btn-sm" onClick={openAddRow} title="Insert a new row">
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
