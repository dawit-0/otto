import { useState, useRef, useCallback } from 'react';
import { api, type Column } from '../api';

interface Props {
  columns: string[];
  rows: Record<string, unknown>[];
  total?: number;
  limit?: number;
  offset?: number;
  onPageChange?: (offset: number) => void;
  exportFilename?: string;
  // Edit mode
  dbId?: string;
  tableName?: string;
  columnDefs?: Column[];
  onDataChange?: () => void;
}

interface EditingCell {
  rowIndex: number;
  col: string;
  value: string;
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
  dbId,
  tableName,
  columnDefs,
  onDataChange,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [addingRow, setAddingRow] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addRowRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const errorTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canEdit = !!(dbId && tableName);

  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimeout.current) clearTimeout(errorTimeout.current);
    errorTimeout.current = setTimeout(() => setError(null), 4000);
  }, []);

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

  // ── Edit mode ──

  const toggleEditMode = () => {
    setEditMode((prev) => !prev);
    setEditingCell(null);
    setAddingRow(null);
    setError(null);
  };

  const startEdit = (rowIndex: number, col: string) => {
    if (!editMode) return;
    const val = rows[rowIndex][col];
    setEditingCell({ rowIndex, col, value: val === null || val === undefined ? '' : String(val) });
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commitEdit = async () => {
    if (!editingCell || !dbId || !tableName || saving) return;
    const row = rows[editingCell.rowIndex];
    const rowid = row['__rowid__'] as number | undefined;
    if (rowid === undefined) { setEditingCell(null); return; }

    const originalVal = row[editingCell.col];
    const originalStr = originalVal === null || originalVal === undefined ? '' : String(originalVal);
    if (editingCell.value === originalStr) { setEditingCell(null); return; }

    setSaving(true);
    try {
      await api.updateRow(dbId, tableName, rowid, { [editingCell.col]: editingCell.value });
      onDataChange?.();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to save change');
    } finally {
      setSaving(false);
      setEditingCell(null);
    }
  };

  const cancelEdit = () => setEditingCell(null);

  const handleCellKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') cancelEdit();
  };

  const handleDeleteRow = async (rowIndex: number) => {
    if (!dbId || !tableName) return;
    const row = rows[rowIndex];
    const rowid = row['__rowid__'] as number | undefined;
    if (rowid === undefined) return;
    if (!window.confirm('Delete this row? This cannot be undone.')) return;
    setSaving(true);
    try {
      await api.deleteRow(dbId, tableName, rowid);
      onDataChange?.();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to delete row');
    } finally {
      setSaving(false);
    }
  };

  const startAddRow = () => {
    const blank: Record<string, string> = {};
    columns.forEach((c) => { blank[c] = ''; });
    setAddingRow(blank);
    setTimeout(() => {
      const first = addRowRefs.current[columns[0]];
      first?.focus();
    }, 0);
  };

  const handleAddRowKeyDown = (e: React.KeyboardEvent, col: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const idx = columns.indexOf(col);
      if (idx < columns.length - 1) {
        addRowRefs.current[columns[idx + 1]]?.focus();
      } else {
        commitAddRow();
      }
    } else if (e.key === 'Escape') {
      setAddingRow(null);
    }
  };

  const commitAddRow = async () => {
    if (!addingRow || !dbId || !tableName || saving) return;
    setSaving(true);
    try {
      await api.insertRow(dbId, tableName, addingRow);
      setAddingRow(null);
      onDataChange?.();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to insert row');
    } finally {
      setSaving(false);
    }
  };

  const pkColumns = new Set(columnDefs?.filter((c) => c.pk).map((c) => c.name) ?? []);

  return (
    <div className="table-browser">
      {error && (
        <div className="edit-error-banner">
          <span>{error}</span>
          <button className="btn-icon edit-error-dismiss" onClick={() => setError(null)}>&#x2715;</button>
        </div>
      )}

      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              {editMode && <th className="edit-action-col" />}
              {columns.map((col) => (
                <th key={col} className={pkColumns.has(col) ? 'col-pk' : ''}>
                  {col}{pkColumns.has(col) && <span className="col-pk-badge" title="Primary key">PK</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={editMode ? 'editable-row' : ''}>
                {editMode && (
                  <td className="edit-action-col">
                    <button
                      className="btn-icon edit-delete-btn"
                      title="Delete row"
                      onClick={() => handleDeleteRow(i)}
                      disabled={saving}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4h6v2" />
                      </svg>
                    </button>
                  </td>
                )}
                {columns.map((col) => {
                  const val = row[col];
                  const isNull = val === null || val === undefined;
                  const isEditing = editMode && editingCell?.rowIndex === i && editingCell?.col === col;

                  if (isEditing) {
                    return (
                      <td key={col} className="editing-cell">
                        <input
                          ref={inputRef}
                          className="cell-input"
                          value={editingCell.value}
                          onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                          onKeyDown={handleCellKeyDown}
                          onBlur={commitEdit}
                          disabled={saving}
                        />
                      </td>
                    );
                  }

                  return (
                    <td
                      key={col}
                      className={`${isNull ? 'null-value' : ''}${editMode ? ' editable-cell' : ''}`}
                      onDoubleClick={() => startEdit(i, col)}
                      title={editMode ? 'Double-click to edit' : undefined}
                    >
                      {isNull ? 'NULL' : String(val)}
                    </td>
                  );
                })}
              </tr>
            ))}

            {addingRow && (
              <tr className="new-row">
                {editMode && <td className="edit-action-col" />}
                {columns.map((col) => (
                  <td key={col} className="editing-cell">
                    <input
                      ref={(el) => { addRowRefs.current[col] = el; }}
                      className="cell-input"
                      placeholder={pkColumns.has(col) ? 'auto' : 'NULL'}
                      value={addingRow[col]}
                      onChange={(e) => setAddingRow({ ...addingRow, [col]: e.target.value })}
                      onKeyDown={(e) => handleAddRowKeyDown(e, col)}
                      disabled={saving}
                    />
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editMode && (
        <div className="edit-add-row-bar">
          {addingRow ? (
            <>
              <button className="btn btn-sm btn-primary" onClick={commitAddRow} disabled={saving}>
                {saving ? 'Saving…' : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Save row
                  </>
                )}
              </button>
              <button className="btn btn-sm" onClick={() => setAddingRow(null)} disabled={saving}>Cancel</button>
            </>
          ) : (
            <button className="btn btn-sm edit-add-btn" onClick={startAddRow}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add row
            </button>
          )}
        </div>
      )}

      <div className="table-footer">
        <div className="table-footer-left">
          {hasPagination && onPageChange ? (
            <>
              <button className="btn btn-sm" disabled={offset === 0} onClick={() => onPageChange(Math.max(0, offset - limit))}>
                Previous
              </button>
              <span className="table-footer-page">Page {page} of {totalPages}</span>
              <button className="btn btn-sm" disabled={offset + limit >= total!} onClick={() => onPageChange(offset + limit)}>
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
            <button
              className={`btn btn-sm${editMode ? ' btn-edit-active' : ''}`}
              onClick={toggleEditMode}
              title={editMode ? 'Exit edit mode' : 'Edit rows inline'}
            >
              {editMode ? (
                <>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Done editing
                </>
              ) : (
                <>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Edit
                </>
              )}
            </button>
          )}
          <button className="btn btn-sm" onClick={handleDownloadCSV} title="Download visible rows as a CSV file">
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
              <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>Copied!</>
            ) : 'Copy CSV'}
          </button>
          <button
            className={`btn btn-sm${copyState === 'json' ? ' btn-copy-success' : ''}`}
            onClick={handleCopyJSON}
            title="Copy as JSON array to clipboard"
          >
            {copyState === 'json' ? (
              <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>Copied!</>
            ) : 'Copy JSON'}
          </button>
        </div>
      </div>
    </div>
  );
}
