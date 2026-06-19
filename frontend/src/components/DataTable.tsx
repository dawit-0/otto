import { useState, useRef } from 'react';

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
  /** Enables cell editing, row deletion, and the "add row" form. Requires pkColumns. */
  editable?: boolean;
  pkColumns?: string[];
  onUpdateCell?: (pk: Record<string, unknown>, column: string, value: string | null) => Promise<void>;
  onDeleteRow?: (pk: Record<string, unknown>) => Promise<void>;
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
  rowIndex: number;
  column: string;
  value: string;
  original: string | null;
}

interface CellMessage {
  rowIndex: number;
  column: string;
  message: string;
}

export default function DataTable({
  columns, rows, total, limit = 100, offset = 0, onPageChange, exportFilename = 'export', sortColumn, sortDirection, onSort,
  editable = false, pkColumns = [], onUpdateCell, onDeleteRow, onInsertRow,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [savingCell, setSavingCell] = useState<{ rowIndex: number; column: string } | null>(null);
  const [cellError, setCellError] = useState<CellMessage | null>(null);

  const [deletingRowIndex, setDeletingRowIndex] = useState<number | null>(null);
  const [rowDeleteError, setRowDeleteError] = useState<{ rowIndex: number; message: string } | null>(null);

  const [addingRow, setAddingRow] = useState(false);
  const [addingSaving, setAddingSaving] = useState(false);
  const [newRowValues, setNewRowValues] = useState<Record<string, string>>({});
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

  const canEdit = editable && pkColumns.length > 0;

  const getPk = (row: Record<string, unknown>) =>
    Object.fromEntries(pkColumns.map((c) => [c, row[c]]));

  const startEdit = (rowIndex: number, column: string, value: unknown) => {
    if (!canEdit) return;
    const str = value === null || value === undefined ? '' : String(value);
    setEditingCell({ rowIndex, column, value: str, original: value === null || value === undefined ? null : str });
    setCellError(null);
  };

  const cancelEdit = () => setEditingCell(null);

  const commitEdit = async (forceNull = false) => {
    if (!editingCell || !onUpdateCell || savingCell) return;
    const { rowIndex, column, value, original } = editingCell;
    if (!forceNull && value === (original ?? '')) {
      setEditingCell(null);
      return;
    }
    const pk = getPk(rows[rowIndex]);
    setSavingCell({ rowIndex, column });
    try {
      await onUpdateCell(pk, column, forceNull ? null : value);
      setEditingCell(null);
      setCellError(null);
    } catch (e) {
      setCellError({ rowIndex, column, message: e instanceof Error ? e.message : 'Update failed' });
    } finally {
      setSavingCell(null);
    }
  };

  const handleDeleteRow = async (rowIndex: number) => {
    if (!onDeleteRow) return;
    if (!window.confirm('Delete this row? This cannot be undone.')) return;
    const pk = getPk(rows[rowIndex]);
    setDeletingRowIndex(rowIndex);
    setRowDeleteError(null);
    try {
      await onDeleteRow(pk);
    } catch (e) {
      setRowDeleteError({ rowIndex, message: e instanceof Error ? e.message : 'Delete failed' });
    } finally {
      setDeletingRowIndex(null);
    }
  };

  const openAddRow = () => {
    setNewRowValues({});
    setAddRowError(null);
    setAddingRow(true);
  };

  const cancelAddRow = () => {
    setAddingRow(false);
    setAddRowError(null);
  };

  const saveNewRow = async () => {
    if (!onInsertRow) return;
    setAddingSaving(true);
    setAddRowError(null);
    try {
      const values: Record<string, string> = {};
      for (const col of columns) {
        const v = newRowValues[col];
        if (v !== undefined && v !== '') values[col] = v;
      }
      await onInsertRow(values);
      setAddingRow(false);
      setNewRowValues({});
    } catch (e) {
      setAddRowError(e instanceof Error ? e.message : 'Insert failed');
    } finally {
      setAddingSaving(false);
    }
  };

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
              <>
                <tr className="new-row">
                  {columns.map((col, idx) => (
                    <td key={col}>
                      <input
                        className="cell-edit-input"
                        placeholder={col}
                        autoFocus={idx === 0}
                        value={newRowValues[col] ?? ''}
                        disabled={addingSaving}
                        onChange={(e) => setNewRowValues((prev) => ({ ...prev, [col]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); saveNewRow(); }
                          if (e.key === 'Escape') { e.preventDefault(); cancelAddRow(); }
                        }}
                      />
                    </td>
                  ))}
                  <td className="row-actions-cell new-row-actions">
                    <button type="button" className="btn btn-sm btn-primary" onClick={saveNewRow} disabled={addingSaving}>
                      Save
                    </button>
                    <button type="button" className="btn btn-sm" onClick={cancelAddRow} disabled={addingSaving}>
                      Cancel
                    </button>
                  </td>
                </tr>
                {addRowError && (
                  <tr className="new-row-error-row">
                    <td colSpan={columns.length + 1} className="new-row-error">{addRowError}</td>
                  </tr>
                )}
              </>
            )}
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => {
                  const val = row[col];
                  const isNull = val === null || val === undefined;
                  const isEditingThis = editingCell?.rowIndex === i && editingCell.column === col;
                  const isSavingThis = savingCell?.rowIndex === i && savingCell.column === col;
                  const hasError = cellError?.rowIndex === i && cellError.column === col;
                  return (
                    <td
                      key={col}
                      className={`${isNull ? 'null-value' : ''}${canEdit ? ' editable-cell' : ''}${hasError ? ' cell-error' : ''}`}
                      onDoubleClick={canEdit && !isEditingThis ? () => startEdit(i, col, val) : undefined}
                      title={hasError ? cellError!.message : undefined}
                    >
                      {isEditingThis ? (
                        <div className="cell-edit-wrap">
                          <input
                            className="cell-edit-input"
                            autoFocus
                            value={editingCell.value}
                            disabled={isSavingThis}
                            onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                            onBlur={() => commitEdit()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                              if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                            }}
                          />
                          <button
                            type="button"
                            className="cell-null-btn"
                            title="Set to NULL"
                            disabled={isSavingThis}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => commitEdit(true)}
                          >
                            &#8709;
                          </button>
                        </div>
                      ) : (
                        isNull ? 'NULL' : String(val)
                      )}
                    </td>
                  );
                })}
                {canEdit && (
                  <td className="row-actions-cell">
                    <button
                      type="button"
                      className="btn-icon row-delete-btn"
                      title="Delete row"
                      disabled={deletingRowIndex === i}
                      onClick={() => handleDeleteRow(i)}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {rowDeleteError && (
              <tr className="new-row-error-row">
                <td colSpan={columns.length + (canEdit ? 1 : 0)} className="new-row-error">{rowDeleteError.message}</td>
              </tr>
            )}
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
          {canEdit && onInsertRow && (
            <button
              className="btn btn-sm btn-primary"
              onClick={openAddRow}
              disabled={addingRow}
              title="Insert a new row"
            >
              + Add row
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
