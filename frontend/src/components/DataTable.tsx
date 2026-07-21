import { useState, useRef, useEffect } from 'react';

interface ColumnDef {
  name: string;
  notnull: boolean;
  default: string | null;
  pk: boolean;
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
  editMode?: boolean;
  pkColumns?: string[];
  columnDefs?: ColumnDef[];
  onSaveRow?: (pkValues: Record<string, unknown>, updates: Record<string, string | null>) => Promise<void>;
  onDeleteRow?: (pkValues: Record<string, unknown>) => Promise<void>;
  onAddRow?: (values: Record<string, string | null>) => Promise<void>;
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
  columnDefs = [],
  onSaveRow,
  onDeleteRow,
  onAddRow,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingRowIdx, setEditingRowIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});
  const [deletingRowIdx, setDeletingRowIdx] = useState<number | null>(null);
  const [addingRow, setAddingRow] = useState(false);
  const [newRowDraft, setNewRowDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEditingRowIdx(null);
    setEditDraft({});
    setDeletingRowIdx(null);
    setAddingRow(false);
    setNewRowDraft({});
  }, [rows]);

  if (columns.length === 0 && !addingRow) {
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

  const getPkValues = (row: Record<string, unknown>): Record<string, unknown> => {
    const pk: Record<string, unknown> = {};
    pkColumns.forEach((col) => { pk[col] = row[col]; });
    return pk;
  };

  const startEdit = (idx: number) => {
    const row = rows[idx];
    const draft: Record<string, string> = {};
    columns.forEach((col) => { draft[col] = row[col] === null || row[col] === undefined ? '' : String(row[col]); });
    setEditingRowIdx(idx);
    setEditDraft(draft);
    setDeletingRowIdx(null);
  };

  const cancelEdit = () => {
    setEditingRowIdx(null);
    setEditDraft({});
  };

  const saveEdit = async () => {
    if (editingRowIdx === null || !onSaveRow) return;
    setBusy(true);
    try {
      const row = rows[editingRowIdx];
      const pkValues = getPkValues(row);
      const updates: Record<string, string | null> = {};
      columns.forEach((col) => {
        if (!pkColumns.includes(col)) {
          updates[col] = editDraft[col] === '' ? null : editDraft[col];
        }
      });
      await onSaveRow(pkValues, updates);
      setEditingRowIdx(null);
      setEditDraft({});
    } catch {
      // parent handles error display
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async (idx: number) => {
    if (!onDeleteRow) return;
    setBusy(true);
    try {
      const pkValues = getPkValues(rows[idx]);
      await onDeleteRow(pkValues);
      setDeletingRowIdx(null);
    } catch {
      // parent handles error display
    } finally {
      setBusy(false);
    }
  };

  const saveNewRow = async () => {
    if (!onAddRow) return;
    setBusy(true);
    try {
      const values: Record<string, string | null> = {};
      columns.forEach((col) => {
        const v = newRowDraft[col];
        values[col] = v === undefined || v === '' ? null : v;
      });
      await onAddRow(values);
      setAddingRow(false);
      setNewRowDraft({});
    } catch {
      // parent handles error display
    } finally {
      setBusy(false);
    }
  };

  const renderActionCell = (idx: number, row: Record<string, unknown>) => {
    if (editingRowIdx === idx) {
      return (
        <td className="edit-actions-cell">
          <button
            className="row-action-btn save"
            title="Save changes"
            disabled={busy}
            onClick={saveEdit}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
          <button
            className="row-action-btn"
            title="Cancel"
            disabled={busy}
            onClick={cancelEdit}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </td>
      );
    }
    if (deletingRowIdx === idx) {
      return (
        <td className="edit-actions-cell">
          <div className="delete-confirm-inline">
            <button
              className="btn-confirm-delete"
              disabled={busy}
              onClick={() => confirmDelete(idx)}
            >
              Delete
            </button>
            <button
              className="btn-cancel-delete"
              disabled={busy}
              onClick={() => setDeletingRowIdx(null)}
            >
              No
            </button>
          </div>
        </td>
      );
    }
    return (
      <td className="edit-actions-cell">
        <button
          className="row-action-btn"
          title="Edit row"
          disabled={busy || editingRowIdx !== null || addingRow}
          onClick={() => startEdit(idx)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        <button
          className="row-action-btn danger"
          title="Delete row"
          disabled={busy || editingRowIdx !== null || addingRow}
          onClick={() => { setDeletingRowIdx(idx); }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      </td>
    );
    void row;
  };

  return (
    <div className="table-browser">
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              {editMode && pkColumns.length > 0 && (
                <th className="edit-actions-th" />
              )}
              {columns.map((col) => (
                <th
                  key={col}
                  className={onSort ? 'sortable-th' : ''}
                  onClick={onSort ? () => onSort(col) : undefined}
                >
                  {col}
                  {pkColumns.includes(col) && editMode && (
                    <span className="pk-badge" title="Primary key">PK</span>
                  )}
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
            {rows.map((row, i) => (
              <tr
                key={i}
                className={
                  editingRowIdx === i
                    ? 'tr-editing'
                    : deletingRowIdx === i
                    ? 'tr-deleting'
                    : ''
                }
              >
                {editMode && pkColumns.length > 0 && renderActionCell(i, row)}
                {columns.map((col) => {
                  if (editingRowIdx === i) {
                    const isPk = pkColumns.includes(col);
                    return (
                      <td key={col} className="edit-cell">
                        <input
                          className={`cell-input${isPk ? ' cell-input-pk' : ''}`}
                          value={editDraft[col] ?? ''}
                          disabled={isPk || busy}
                          title={isPk ? 'Primary key — cannot be edited' : undefined}
                          onChange={(e) => setEditDraft((d) => ({ ...d, [col]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit();
                            if (e.key === 'Escape') cancelEdit();
                          }}
                        />
                      </td>
                    );
                  }
                  const val = row[col];
                  const isNull = val === null || val === undefined;
                  return (
                    <td key={col} className={isNull ? 'null-value' : ''}>
                      {isNull ? 'NULL' : String(val)}
                    </td>
                  );
                })}
              </tr>
            ))}

            {addingRow && (
              <tr className="tr-new-row">
                {editMode && pkColumns.length > 0 && (
                  <td className="edit-actions-cell">
                    <button
                      className="row-action-btn save"
                      title="Save new row"
                      disabled={busy}
                      onClick={saveNewRow}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                    <button
                      className="row-action-btn"
                      title="Cancel"
                      disabled={busy}
                      onClick={() => { setAddingRow(false); setNewRowDraft({}); }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </td>
                )}
                {columns.map((col) => {
                  const isPk = pkColumns.includes(col);
                  const colDef = columnDefs.find((c) => c.name === col);
                  const hasDefault = colDef?.default !== null;
                  return (
                    <td key={col} className="edit-cell new-row-cell">
                      <input
                        className={`cell-input${isPk ? ' cell-input-pk' : ''}`}
                        value={newRowDraft[col] ?? ''}
                        placeholder={isPk ? 'auto' : hasDefault ? `default` : ''}
                        disabled={busy}
                        onChange={(e) => setNewRowDraft((d) => ({ ...d, [col]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') { setAddingRow(false); setNewRowDraft({}); }
                        }}
                      />
                    </td>
                  );
                })}
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

          {editMode && pkColumns.length > 0 && onAddRow && (
            <button
              className="btn btn-sm btn-add-row"
              disabled={busy || editingRowIdx !== null || addingRow}
              onClick={() => { setAddingRow(true); setNewRowDraft({}); }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Row
            </button>
          )}
        </div>

        <div className="table-footer-right">
          <button
            className="btn btn-sm"
            onClick={() => downloadFile(`${exportFilename}.csv`, toCSV(columns, rows), 'text/csv;charset=utf-8;')}
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
            onClick={() => triggerCopy('csv', toCSV(columns, rows))}
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
            onClick={() => triggerCopy('json', toJSON(columns, rows))}
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
