import { useState, useRef, useEffect, useCallback } from 'react';

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
  // Edit mode
  editMode?: boolean;
  pkColumn?: string | null;
  onSave?: (data: EditSaveData) => Promise<void>;
}

export interface EditSaveData {
  updates: Array<{ pk: unknown; changes: Record<string, unknown> }>;
  deletes: unknown[];
  inserts: Record<string, unknown>[];
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

// Serialize a PK value to a stable string key for use in Maps/Sets
function pkKey(val: unknown): string {
  return JSON.stringify(val);
}

export default function DataTable({
  columns, rows, total, limit = 100, offset = 0,
  onPageChange, exportFilename = 'export',
  sortColumn, sortDirection, onSort,
  editMode = false, pkColumn, onSave,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Edit state — map from pkKey string → {col: newValue}
  const [rowEdits, setRowEdits] = useState<Map<string, Record<string, unknown>>>(new Map());
  // Set of pkKey strings to delete
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set());
  // Pending inserts
  const [insertRows, setInsertRows] = useState<Record<string, unknown>[]>([]);
  // Active cell being edited: key is pkKey string (existing) or `new:${i}` (insert)
  const [activeEdit, setActiveEdit] = useState<{ key: string; col: string } | null>(null);
  const [editBuffer, setEditBuffer] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Reset all edit state when edit mode is turned off
  useEffect(() => {
    if (!editMode) {
      setRowEdits(new Map());
      setDeletedKeys(new Set());
      setInsertRows([]);
      setActiveEdit(null);
      setSaveError(null);
    }
  }, [editMode]);

  // Focus input when a cell becomes active
  useEffect(() => {
    if (activeEdit) editInputRef.current?.focus();
  }, [activeEdit]);

  if (columns.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">{'{ }'}</div>
        <div className="empty-state-title">No results</div>
        <div className="empty-state-text">Run a query to see results here.</div>
      </div>
    );
  }

  const hasPagination = !editMode && total !== undefined && total > limit;
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

  // ── Edit mode helpers ──────────────────────────────────────────────

  const getPkValue = (row: Record<string, unknown>) =>
    pkColumn ? row[pkColumn] : null;

  const startCellEdit = (key: string, col: string, currentVal: unknown) => {
    if (activeEdit) commitEdit();
    setActiveEdit({ key, col });
    setEditBuffer(currentVal === null || currentVal === undefined ? '' : String(currentVal));
  };

  const commitEdit = useCallback(() => {
    if (!activeEdit) return;
    const { key, col } = activeEdit;

    const isNew = key.startsWith('new:');
    const newIdx = isNew ? parseInt(key.slice(4)) : -1;

    const normalised: unknown = editBuffer === '' ? null : editBuffer;

    if (isNew) {
      setInsertRows((prev) =>
        prev.map((r, i) => i === newIdx ? { ...r, [col]: normalised } : r)
      );
    } else {
      setRowEdits((prev) => {
        const m = new Map(prev);
        const existing = m.get(key) ?? {};
        m.set(key, { ...existing, [col]: normalised });
        return m;
      });
    }
    setActiveEdit(null);
  }, [activeEdit, editBuffer]);

  const cancelEdit = () => {
    setActiveEdit(null);
  };

  const handleCellClick = (key: string, col: string, currentVal: unknown) => {
    if (!editMode) return;
    if (activeEdit?.key === key && activeEdit?.col === col) return;
    startCellEdit(key, col, currentVal);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    if (e.key === 'Tab') { e.preventDefault(); commitEdit(); }
  };

  const handleDeleteRow = (key: string) => {
    setDeletedKeys((prev) => { const s = new Set(prev); s.add(key); return s; });
    if (activeEdit?.key === key) setActiveEdit(null);
  };

  const handleUndoDelete = (key: string) => {
    setDeletedKeys((prev) => { const s = new Set(prev); s.delete(key); return s; });
  };

  const handleAddRow = () => {
    const empty: Record<string, unknown> = {};
    columns.forEach((c) => { empty[c] = null; });
    setInsertRows((prev) => [...prev, empty]);
  };

  const handleDeleteInsertRow = (idx: number) => {
    setInsertRows((prev) => prev.filter((_, i) => i !== idx));
    if (activeEdit?.key === `new:${idx}`) setActiveEdit(null);
  };

  const pendingCount =
    rowEdits.size + deletedKeys.size + insertRows.length;

  const handleSave = async () => {
    if (!onSave) return;
    // Commit any active edit first
    if (activeEdit) commitEdit();

    setSaving(true);
    setSaveError(null);
    try {
      const updates = [...rowEdits.entries()].map(([k, changes]) => ({
        pk: JSON.parse(k),
        changes,
      }));
      const deletes = [...deletedKeys].map((k) => JSON.parse(k));
      const inserts = insertRows;
      await onSave({ updates, deletes, inserts });
      // Parent reloads; state reset happens via editMode prop cycling or parent
      setRowEdits(new Map());
      setDeletedKeys(new Set());
      setInsertRows([]);
      setActiveEdit(null);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Render cells ──────────────────────────────────────────────────

  const renderCell = (row: Record<string, unknown>, col: string, rowKey: string) => {
    const isDeleted = deletedKeys.has(rowKey);
    const isEditing = activeEdit?.key === rowKey && activeEdit?.col === col;
    const editedVal = rowEdits.get(rowKey)?.[col];
    const hasEdit = editedVal !== undefined;
    const displayVal = hasEdit ? editedVal : row[col];
    const isNull = displayVal === null || displayVal === undefined;

    if (isEditing) {
      return (
        <td key={col} className="cell-editing" onBlur={commitEdit}>
          <input
            ref={editInputRef}
            className="edit-cell-input"
            value={editBuffer}
            onChange={(e) => setEditBuffer(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="NULL"
          />
        </td>
      );
    }

    return (
      <td
        key={col}
        className={[
          isNull ? 'null-value' : '',
          hasEdit && !isDeleted ? 'cell-edited' : '',
          editMode && pkColumn && !isDeleted ? 'cell-editable' : '',
        ].filter(Boolean).join(' ')}
        onClick={() => !isDeleted && handleCellClick(rowKey, col, displayVal)}
      >
        {isNull ? 'NULL' : String(displayVal)}
      </td>
    );
  };

  const renderInsertCell = (row: Record<string, unknown>, col: string, idx: number) => {
    const key = `new:${idx}`;
    const isEditing = activeEdit?.key === key && activeEdit?.col === col;
    const val = row[col];
    const isNull = val === null || val === undefined;

    if (isEditing) {
      return (
        <td key={col} className="cell-editing" onBlur={commitEdit}>
          <input
            ref={editInputRef}
            className="edit-cell-input"
            value={editBuffer}
            onChange={(e) => setEditBuffer(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="NULL"
          />
        </td>
      );
    }

    return (
      <td
        key={col}
        className={['cell-editable', isNull ? 'null-value' : ''].filter(Boolean).join(' ')}
        onClick={() => handleCellClick(key, col, val)}
      >
        {isNull ? 'NULL' : String(val)}
      </td>
    );
  };

  return (
    <div className="table-browser">
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              {editMode && <th className="edit-row-actions-col" />}
              {columns.map((col) => (
                <th
                  key={col}
                  className={onSort && !editMode ? 'sortable-th' : ''}
                  onClick={onSort && !editMode ? () => onSort(col) : undefined}
                >
                  {col}
                  {onSort && !editMode && (
                    <span className="sort-arrow">
                      {sortColumn === col ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const pk = getPkValue(row);
              const key = pk !== null && pk !== undefined ? pkKey(pk) : `row:${i}`;
              const isDeleted = deletedKeys.has(key);
              return (
                <tr key={i} className={isDeleted ? 'row-deleted' : ''}>
                  {editMode && (
                    <td className="edit-row-actions-cell">
                      {isDeleted ? (
                        <button
                          className="btn-icon btn-undo-delete"
                          onClick={() => handleUndoDelete(key)}
                          title="Undo delete"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 7v6h6" /><path d="M3 13C5.4 8.1 10.2 5 16 5c5 0 9 3.6 9 9s-4 9-9 9" />
                          </svg>
                        </button>
                      ) : pkColumn ? (
                        <button
                          className="btn-icon btn-delete-row"
                          onClick={() => handleDeleteRow(key)}
                          title="Delete row"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      ) : null}
                    </td>
                  )}
                  {columns.map((col) => renderCell(row, col, key))}
                </tr>
              );
            })}

            {/* Pending insert rows */}
            {insertRows.map((row, idx) => (
              <tr key={`new-${idx}`} className="row-new">
                {editMode && (
                  <td className="edit-row-actions-cell">
                    <button
                      className="btn-icon btn-delete-row"
                      onClick={() => handleDeleteInsertRow(idx)}
                      title="Remove new row"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </td>
                )}
                {columns.map((col) => renderInsertCell(row, col, idx))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div className="table-footer">
        <div className="table-footer-left">
          {editMode ? (
            <>
              <button className="btn btn-sm" onClick={handleAddRow}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add Row
              </button>
              {pendingCount > 0 && (
                <span className="edit-pending-badge">
                  {pendingCount} pending change{pendingCount !== 1 ? 's' : ''}
                </span>
              )}
              {saveError && (
                <span className="edit-save-error">{saveError}</span>
              )}
            </>
          ) : hasPagination && onPageChange ? (
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
          {editMode ? (
            <>
              {onSave && (
                <button
                  className={`btn btn-sm btn-save-changes${pendingCount > 0 ? '' : ' btn-save-changes-disabled'}`}
                  onClick={handleSave}
                  disabled={saving || pendingCount === 0}
                >
                  {saving ? (
                    'Saving…'
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Save {pendingCount > 0 ? `${pendingCount} ` : ''}Changes
                    </>
                  )}
                </button>
              )}
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
