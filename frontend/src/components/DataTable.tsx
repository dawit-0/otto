import { useState, useRef, useEffect } from 'react';
import { api, type Column } from '../api';

// ─── SQL helpers ──────────────────────────────────────────────────────────────

/** Produce a SQL literal for a string value typed by the user. */
function sqlLiteral(val: string): string {
  const t = val.trim();
  if (t === '' || t.toLowerCase() === 'null') return 'NULL';
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return t;
  return `'${t.replace(/'/g, "''")}'`;
}

function makeUpdate(
  table: string,
  origRow: Record<string, unknown>,
  edits: Record<string, string>,
  pkCols: string[],
): string {
  const sets = Object.entries(edits)
    .map(([c, v]) => `"${c}" = ${sqlLiteral(v)}`)
    .join(', ');
  const where = pkCols
    .map((pk) => `"${pk}" = ${sqlLiteral(String(origRow[pk] ?? ''))}`)
    .join(' AND ');
  return `UPDATE "${table}" SET ${sets} WHERE ${where}`;
}

function makeDelete(table: string, row: Record<string, unknown>, pkCols: string[]): string {
  const where = pkCols
    .map((pk) => `"${pk}" = ${sqlLiteral(String(row[pk] ?? ''))}`)
    .join(' AND ');
  return `DELETE FROM "${table}" WHERE ${where}`;
}

function makeInsert(table: string, row: Record<string, string>, cols: string[]): string {
  const filled = cols.filter((c) => row[c]?.trim());
  if (!filled.length) return '';
  return `INSERT INTO "${table}" (${filled.map((c) => `"${c}"`).join(', ')}) VALUES (${filled.map((c) => sqlLiteral(row[c])).join(', ')})`;
}

/** Parse a cell key like "row-5-colName" or "new-2-colName". */
function parseCellKey(cellKey: string): { isNew: boolean; idx: number; col: string } {
  const isNew = cellKey.startsWith('new-');
  const afterPrefix = cellKey.slice(isNew ? 4 : 4); // "row-" or "new-" are both 4 chars
  const dashIdx = afterPrefix.indexOf('-');
  return {
    isNew,
    idx: parseInt(afterPrefix.slice(0, dashIdx), 10),
    col: afterPrefix.slice(dashIdx + 1),
  };
}

// ─── CSV / JSON helpers ───────────────────────────────────────────────────────

function toCSV(columns: string[], rows: Record<string, unknown>[]): string {
  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  return [
    columns.map(escape).join(','),
    ...rows.map((row) => columns.map((col) => escape(row[col])).join(',')),
  ].join('\n');
}

function toJSON(columns: string[], rows: Record<string, unknown>[]): string {
  return JSON.stringify(
    rows.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col) => { obj[col] = row[col] ?? null; });
      return obj;
    }),
    null,
    2,
  );
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Props ────────────────────────────────────────────────────────────────────

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
  // Edit mode (only meaningful in the table browser, not query results)
  editable?: boolean;
  columnDefs?: Column[];
  dbId?: string;
  tableName?: string;
  onDataChange?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

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
  editable = false,
  columnDefs = [],
  dbId,
  tableName,
  onDataChange,
}: Props) {
  // ── Copy/export state ────────────────────────────────────────────────────
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Edit mode state ──────────────────────────────────────────────────────
  // Map "row-N" → { colName → newValue } for existing-row edits
  const [editedCells, setEditedCells] = useState<Map<string, Record<string, string>>>(new Map());
  // Indices into the current page's `rows` array that are pending deletion
  const [pendingDeletes, setPendingDeletes] = useState<Set<number>>(new Set());
  // New rows being composed (shown after existing rows)
  const [newRows, setNewRows] = useState<Record<string, string>[]>([]);
  // Which cell is currently being edited: "row-N-colName" or "new-N-colName"
  const [activeCellKey, setActiveCellKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const saveMsgTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear edit state when edit mode is disabled by the parent
  useEffect(() => {
    if (!editable) {
      setEditedCells(new Map());
      setPendingDeletes(new Set());
      setNewRows([]);
      setActiveCellKey(null);
      setSaveMsg(null);
    }
  }, [editable]);

  const pkColumns = columnDefs.filter((c) => c.pk).map((c) => c.name);
  const canEdit = editable && pkColumns.length > 0;

  const hasNewRowContent = (r: Record<string, string>) =>
    Object.values(r).some((v) => v.trim() !== '');

  const pendingCount =
    editedCells.size +
    pendingDeletes.size +
    newRows.filter(hasNewRowContent).length;

  // ── Editing actions ──────────────────────────────────────────────────────

  const startEdit = (cellKey: string, currentVal: string) => {
    if (!canEdit) return;
    setActiveCellKey(cellKey);
    setEditingValue(currentVal === 'NULL' ? '' : currentVal);
  };

  const commitEdit = (cellKey: string, value: string) => {
    const { isNew, idx, col } = parseCellKey(cellKey);

    if (!isNew) {
      const rowKey = `row-${idx}`;
      const origVal = rows[idx]?.[col];
      const origStr = origVal === null || origVal === undefined ? '' : String(origVal);

      setEditedCells((prev) => {
        const next = new Map(prev);
        const rowEdits = { ...(next.get(rowKey) ?? {}) };
        const unchanged =
          value === origStr ||
          (value.trim() === '' && (origVal === null || origVal === undefined));

        if (unchanged) {
          delete rowEdits[col];
          if (Object.keys(rowEdits).length === 0) next.delete(rowKey);
          else next.set(rowKey, rowEdits);
        } else {
          rowEdits[col] = value;
          next.set(rowKey, rowEdits);
        }
        return next;
      });
    } else {
      setNewRows((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, [col]: value } : r)),
      );
    }

    setActiveCellKey(null);
  };

  const toggleDelete = (rowIdx: number) => {
    setPendingDeletes((prev) => {
      const next = new Set(prev);
      if (next.has(rowIdx)) next.delete(rowIdx);
      else next.add(rowIdx);
      return next;
    });
  };

  const addNewRow = () => {
    const blank: Record<string, string> = {};
    columns.forEach((c) => { blank[c] = ''; });
    setNewRows((prev) => [...prev, blank]);
  };

  const removeNewRow = (idx: number) => {
    setNewRows((prev) => prev.filter((_, i) => i !== idx));
    if (activeCellKey?.startsWith(`new-${idx}-`)) setActiveCellKey(null);
  };

  const discardChanges = () => {
    setEditedCells(new Map());
    setPendingDeletes(new Set());
    setNewRows([]);
    setActiveCellKey(null);
    setSaveMsg(null);
  };

  const saveChanges = async () => {
    if (!dbId || !tableName) return;
    setSaving(true);
    setSaveMsg(null);

    let ok = 0, fail = 0;

    // Deletes first (so we don't UPDATE a row we're about to delete)
    for (const rowIdx of Array.from(pendingDeletes)) {
      const sql = makeDelete(tableName, rows[rowIdx], pkColumns);
      try { await api.executeQuery(dbId, sql); ok++; }
      catch { fail++; }
    }

    // Updates (skip rows also pending deletion)
    for (const [rowKey, edits] of Array.from(editedCells)) {
      const rowIdx = parseInt(rowKey.slice(4), 10);
      if (pendingDeletes.has(rowIdx)) continue;
      if (!Object.keys(edits).length) continue;
      const sql = makeUpdate(tableName, rows[rowIdx], edits, pkColumns);
      try { await api.executeQuery(dbId, sql); ok++; }
      catch { fail++; }
    }

    // Inserts
    for (const newRow of newRows) {
      if (!hasNewRowContent(newRow)) continue;
      const sql = makeInsert(tableName, newRow, columns);
      if (!sql) continue;
      try { await api.executeQuery(dbId, sql); ok++; }
      catch { fail++; }
    }

    setSaving(false);

    const msg =
      fail === 0
        ? { ok: true, text: `${ok} change${ok !== 1 ? 's' : ''} saved` }
        : ok > 0
        ? { ok: false, text: `${ok} saved · ${fail} failed` }
        : { ok: false, text: `All ${fail} change${fail !== 1 ? 's' : ''} failed` };
    setSaveMsg(msg);

    if (ok > 0) {
      setEditedCells(new Map());
      setPendingDeletes(new Set());
      setNewRows([]);
      onDataChange?.();
    }

    if (saveMsgTimeout.current) clearTimeout(saveMsgTimeout.current);
    saveMsgTimeout.current = setTimeout(() => setSaveMsg(null), 4000);
  };

  // ── Export / copy actions ────────────────────────────────────────────────

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

  // ── Render ───────────────────────────────────────────────────────────────

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
  // Disable pagination when there are unsaved changes (indices are page-relative)
  const canChangePage = pendingCount === 0;

  return (
    <div className="table-browser">

      {/* ── No-PK warning (edit mode requested but no PK) ── */}
      {editable && !canEdit && (
        <div className="edit-no-pk-banner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Row editing is disabled — this table has no primary key.
        </div>
      )}

      {/* ── Pending-changes banner ── */}
      {canEdit && (pendingCount > 0 || saveMsg) && (
        <div className="edit-pending-banner">
          {pendingCount > 0 && (
            <>
              <span className="edit-mode-dot" />
              <span className="edit-pending-label">
                {pendingCount} unsaved change{pendingCount !== 1 ? 's' : ''}
              </span>
            </>
          )}
          {saveMsg && (
            <span className={`save-result-inline ${saveMsg.ok ? 'ok' : 'fail'}`}>
              {saveMsg.ok ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              )}
              {saveMsg.text}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={discardChanges} disabled={saving}>
            Discard
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={saveChanges}
            disabled={saving || pendingCount === 0}
          >
            {saving ? 'Saving…' : `Save ${pendingCount > 0 ? `${pendingCount} ` : ''}change${pendingCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              {canEdit && <th className="edit-col-header" />}
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
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const rowKey = `row-${i}`;
              const isPendingDelete = pendingDeletes.has(i);
              const rowEdits = editedCells.get(rowKey);
              const isEdited = !!rowEdits && Object.keys(rowEdits).length > 0;

              return (
                <tr
                  key={i}
                  className={[
                    isPendingDelete ? 'row-pending-delete' : '',
                    isEdited && !isPendingDelete ? 'row-edited' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {/* Row-action column: delete / restore */}
                  {canEdit && (
                    <td className="edit-col-cell">
                      <button
                        className={`row-action-btn ${isPendingDelete ? 'restore-btn' : 'delete-btn'}`}
                        onClick={() => toggleDelete(i)}
                        title={isPendingDelete ? 'Restore this row' : 'Delete this row'}
                      >
                        {isPendingDelete ? (
                          // Undo arrow
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 14 4 9 9 4" />
                            <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
                          </svg>
                        ) : (
                          // Trash
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        )}
                      </button>
                    </td>
                  )}

                  {/* Data cells */}
                  {columns.map((col) => {
                    const cellKey = `row-${i}-${col}`;
                    const isEditingCell = activeCellKey === cellKey;
                    const editedVal = rowEdits?.[col];
                    const displayVal = editedVal !== undefined ? editedVal : row[col];
                    const isNull = displayVal === null || displayVal === undefined;
                    const isCellEdited = editedVal !== undefined;

                    return (
                      <td
                        key={col}
                        className={[
                          canEdit && !isPendingDelete ? 'editable-cell' : '',
                          isCellEdited ? 'cell-edited' : '',
                          isNull && !isCellEdited ? 'null-value' : '',
                        ].filter(Boolean).join(' ')}
                        onClick={
                          canEdit && !isPendingDelete && !isEditingCell
                            ? () => startEdit(cellKey, isNull ? '' : String(displayVal))
                            : undefined
                        }
                      >
                        {isEditingCell ? (
                          <input
                            className="cell-edit-input"
                            autoFocus
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={() => commitEdit(cellKey, editingValue)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); commitEdit(cellKey, editingValue); }
                              if (e.key === 'Escape') { e.preventDefault(); setActiveCellKey(null); }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : isNull && !isCellEdited ? (
                          'NULL'
                        ) : (
                          String(displayVal)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* ── New rows ── */}
            {newRows.map((newRow, ni) => (
              <tr key={`new-${ni}`} className="row-new">
                <td className="edit-col-cell">
                  <button
                    className="row-action-btn remove-new-btn"
                    onClick={() => removeNewRow(ni)}
                    title="Remove this new row"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </td>
                {columns.map((col) => {
                  const cellKey = `new-${ni}-${col}`;
                  const isEditingCell = activeCellKey === cellKey;
                  const val = newRow[col] ?? '';

                  return (
                    <td
                      key={col}
                      className={`editable-cell ${val ? 'cell-new-filled' : 'cell-new-empty'}`}
                      onClick={!isEditingCell ? () => startEdit(cellKey, val) : undefined}
                    >
                      {isEditingCell ? (
                        <input
                          className="cell-edit-input"
                          autoFocus
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={() => commitEdit(cellKey, editingValue)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); commitEdit(cellKey, editingValue); }
                            if (e.key === 'Escape') { e.preventDefault(); setActiveCellKey(null); }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : val ? (
                        val
                      ) : (
                        <span className="new-cell-placeholder">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div className="table-footer">
        <div className="table-footer-left">
          {canEdit && (
            <button className="btn btn-sm btn-add-row" onClick={addNewRow}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Row
            </button>
          )}
          {hasPagination && onPageChange ? (
            <>
              <button
                className="btn btn-sm"
                disabled={offset === 0 || !canChangePage}
                onClick={() => canChangePage && onPageChange(Math.max(0, offset - limit))}
                title={!canChangePage ? 'Save or discard changes before navigating pages' : undefined}
              >
                Previous
              </button>
              <span className="table-footer-page">Page {page} of {totalPages}</span>
              <button
                className="btn btn-sm"
                disabled={offset + limit >= total! || !canChangePage}
                onClick={() => canChangePage && onPageChange(offset + limit)}
                title={!canChangePage ? 'Save or discard changes before navigating pages' : undefined}
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
