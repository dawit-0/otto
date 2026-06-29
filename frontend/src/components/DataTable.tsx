import { useState, useRef } from 'react';

export interface EditingConfig {
  primaryKey: string[];
  onUpdateCell: (row: Record<string, unknown>, column: string, newValue: string | null) => Promise<void>;
  onDeleteRow: (row: Record<string, unknown>) => Promise<void>;
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
  editing?: EditingConfig;
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

export default function DataTable({ columns, rows, total, limit = 100, offset = 0, onPageChange, exportFilename = 'export', sortColumn, sortDirection, onSort, editing }: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editIsNull, setEditIsNull] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<number | null>(null);
  const [deletingRow, setDeletingRow] = useState<number | null>(null);
  const confirmDeleteTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const startEdit = (rowIndex: number, col: string, row: Record<string, unknown>) => {
    if (!editing) return;
    const val = row[col];
    const isNull = val === null || val === undefined;
    setEditingCell({ row: rowIndex, col });
    setEditValue(isNull ? '' : String(val));
    setEditIsNull(isNull);
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditError(null);
  };

  const commitEdit = async (row: Record<string, unknown>, overrideIsNull?: boolean) => {
    if (!editing || !editingCell) return;
    const { col } = editingCell;
    const isNull = overrideIsNull ?? editIsNull;
    const val = row[col];
    const currentlyNull = val === null || val === undefined;
    const unchanged = isNull ? currentlyNull : !currentlyNull && String(val) === editValue;
    if (unchanged) {
      cancelEdit();
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await editing.onUpdateCell(row, col, isNull ? null : editValue);
      setEditingCell(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteClick = (rowIndex: number, row: Record<string, unknown>) => {
    if (!editing) return;
    if (confirmDeleteRow !== rowIndex) {
      setConfirmDeleteRow(rowIndex);
      if (confirmDeleteTimeout.current) clearTimeout(confirmDeleteTimeout.current);
      confirmDeleteTimeout.current = setTimeout(() => setConfirmDeleteRow(null), 3000);
      return;
    }
    if (confirmDeleteTimeout.current) clearTimeout(confirmDeleteTimeout.current);
    setConfirmDeleteRow(null);
    setDeletingRow(rowIndex);
    editing.onDeleteRow(row).finally(() => setDeletingRow(null));
  };

  return (
    <div className="table-browser">
      <div className="data-table-container">
        <table className={`data-table${editing ? ' data-table-editable' : ''}`}>
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
              {editing && <th className="row-actions-th" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={deletingRow === i ? 'row-deleting' : ''}>
                {columns.map((col) => {
                  const val = row[col];
                  const isNull = val === null || val === undefined;
                  const isEditingThis = editingCell?.row === i && editingCell.col === col;

                  if (isEditingThis) {
                    return (
                      <td key={col} className="cell-editing">
                        <div className="cell-edit-wrap">
                          <input
                            className="cell-edit-input"
                            value={editValue}
                            disabled={editIsNull || editSaving}
                            autoFocus
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit(row);
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            onBlur={() => commitEdit(row)}
                          />
                          <label className="cell-edit-null" onMouseDown={(e) => e.preventDefault()}>
                            <input
                              type="checkbox"
                              checked={editIsNull}
                              disabled={editSaving}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setEditIsNull(checked);
                                if (checked) commitEdit(row, true);
                              }}
                            />
                            NULL
                          </label>
                        </div>
                        {editError && <div className="cell-edit-error">{editError}</div>}
                      </td>
                    );
                  }

                  return (
                    <td
                      key={col}
                      className={`${isNull ? 'null-value' : ''}${editing ? ' editable-cell' : ''}`}
                      onClick={editing ? () => startEdit(i, col, row) : undefined}
                      title={editing ? 'Click to edit' : undefined}
                    >
                      {isNull ? 'NULL' : String(val)}
                    </td>
                  );
                })}
                {editing && (
                  <td className="row-actions-td">
                    <button
                      className={`btn-icon btn-icon-delete-row${confirmDeleteRow === i ? ' confirm-delete' : ''}`}
                      onClick={() => handleDeleteClick(i, row)}
                      disabled={deletingRow === i}
                      title={confirmDeleteRow === i ? 'Click again to confirm delete' : 'Delete row'}
                    >
                      {confirmDeleteRow === i ? (
                        'Confirm?'
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
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
