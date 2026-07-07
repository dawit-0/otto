import { useState, useRef, useEffect } from 'react';
import type { Column } from '../api';

export interface EditConfig {
  pkColumns: string[];
  columnDefs: Column[];
  onSaveEdit: (originalRow: Record<string, unknown>, updates: Record<string, unknown>) => Promise<void>;
  onDelete: (row: Record<string, unknown>) => Promise<void>;
  onInsert: (values: Record<string, unknown>) => Promise<void>;
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
  editConfig?: EditConfig;
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
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function rowToStr(row: Record<string, unknown>, columns: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  columns.forEach((col) => {
    const v = row[col];
    out[col] = v === null || v === undefined ? '' : String(v);
  });
  return out;
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
  editConfig,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Edit state ──
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});
  const [deletingIdx, setDeletingIdx] = useState<number | null>(null);

  // ── Insert state ──
  const [inserting, setInserting] = useState(false);
  const [insertDraft, setInsertDraft] = useState<Record<string, string>>({});
  const firstInsertRef = useRef<HTMLInputElement>(null);

  // ── Op feedback ──
  const [opLoading, setOpLoading] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);

  // Clear edit state when rows change (after a reload)
  useEffect(() => {
    setEditingIdx(null);
    setEditDraft({});
    setDeletingIdx(null);
    setInserting(false);
    setInsertDraft({});
    setOpError(null);
  }, [rows]);

  // Focus first insert input
  useEffect(() => {
    if (inserting) {
      setTimeout(() => firstInsertRef.current?.focus(), 50);
    }
  }, [inserting]);

  if (columns.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">{'{ }'}</div>
        <div className="empty-state-title">No results</div>
        <div className="empty-state-text">Run a query to see results here.</div>
      </div>
    );
  }

  const canEdit = !!(editConfig && editConfig.pkColumns.length > 0);
  const { pkColumns = [], columnDefs = [] } = editConfig ?? {};
  const colDefMap = Object.fromEntries(columnDefs.map((c) => [c.name, c]));

  // ── Edit handlers ──
  const startEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditDraft(rowToStr(rows[idx], columns));
    setDeletingIdx(null);
    setInserting(false);
    setOpError(null);
  };

  const cancelEdit = () => {
    setEditingIdx(null);
    setEditDraft({});
    setOpError(null);
  };

  const saveEdit = async (idx: number) => {
    if (!editConfig) return;
    const original = rows[idx];
    const updates: Record<string, unknown> = {};
    columns.forEach((col) => {
      if (pkColumns.includes(col)) return;
      const newVal = editDraft[col];
      const origStr = original[col] === null || original[col] === undefined ? '' : String(original[col]);
      if (newVal !== origStr) {
        updates[col] = newVal === '' ? null : newVal;
      }
    });
    if (Object.keys(updates).length === 0) {
      cancelEdit();
      return;
    }
    setOpLoading(true);
    setOpError(null);
    try {
      await editConfig.onSaveEdit(original, updates);
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Save failed');
      setOpLoading(false);
    }
  };

  // ── Delete handlers ──
  const confirmDelete = async (idx: number) => {
    if (!editConfig) return;
    setOpLoading(true);
    setOpError(null);
    try {
      await editConfig.onDelete(rows[idx]);
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Delete failed');
      setOpLoading(false);
    }
  };

  // ── Insert handlers ──
  const startInsert = () => {
    const draft: Record<string, string> = {};
    columns.forEach((col) => { draft[col] = ''; });
    setInsertDraft(draft);
    setInserting(true);
    setEditingIdx(null);
    setDeletingIdx(null);
    setOpError(null);
  };

  const cancelInsert = () => {
    setInserting(false);
    setInsertDraft({});
    setOpError(null);
  };

  const saveInsert = async () => {
    if (!editConfig) return;
    const values: Record<string, unknown> = {};
    columns.forEach((col) => {
      const v = insertDraft[col];
      if (v !== '') values[col] = v;
    });
    setOpLoading(true);
    setOpError(null);
    try {
      await editConfig.onInsert(values);
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Insert failed');
      setOpLoading(false);
    }
  };

  // ── Copy/export ──
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

  const handlePageChange = (nextOffset: number) => {
    cancelEdit();
    cancelInsert();
    onPageChange?.(nextOffset);
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
                  <span className="th-inner">
                    {pkColumns.includes(col) && (
                      <span className="pk-badge" title="Primary key">🔑</span>
                    )}
                    {col}
                    {onSort && (
                      <span className="sort-arrow">
                        {sortColumn === col ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅'}
                      </span>
                    )}
                  </span>
                </th>
              ))}
              {canEdit && <th className="actions-th" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isEditing = editingIdx === i;
              const isDeleting = deletingIdx === i;

              if (isEditing) {
                return (
                  <tr key={i} className="editing-row">
                    {columns.map((col) => {
                      const isPk = pkColumns.includes(col);
                      const colDef = colDefMap[col];
                      const isNullable = colDef ? !colDef.notnull : true;
                      return (
                        <td key={col} className="edit-cell">
                          {isPk ? (
                            <span className="pk-locked-value">{String(row[col] ?? 'NULL')}</span>
                          ) : (
                            <input
                              className="row-edit-input"
                              type="text"
                              value={editDraft[col] ?? ''}
                              placeholder={isNullable ? 'NULL' : 'required'}
                              onChange={(e) => setEditDraft((d) => ({ ...d, [col]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEdit(i);
                                if (e.key === 'Escape') cancelEdit();
                              }}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="actions-td">
                      <div className="row-actions row-actions-visible">
                        <button
                          className="row-action-btn save-btn"
                          title="Save (Enter)"
                          disabled={opLoading}
                          onClick={() => saveEdit(i)}
                        >
                          {opLoading ? '…' : '✓'}
                        </button>
                        <button
                          className="row-action-btn cancel-btn"
                          title="Cancel (Esc)"
                          disabled={opLoading}
                          onClick={cancelEdit}
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }

              if (isDeleting) {
                return (
                  <tr key={i} className="deleting-row">
                    {columns.map((col) => (
                      <td key={col} className="delete-cell">
                        <span className={row[col] === null ? 'null-value' : ''}>
                          {row[col] === null || row[col] === undefined ? 'NULL' : String(row[col])}
                        </span>
                      </td>
                    ))}
                    <td className="actions-td">
                      <div className="row-actions row-actions-visible delete-confirm-actions">
                        <span className="delete-confirm-label">Delete?</span>
                        <button
                          className="row-action-btn confirm-delete-btn"
                          disabled={opLoading}
                          onClick={() => confirmDelete(i)}
                        >
                          {opLoading ? '…' : 'Delete'}
                        </button>
                        <button
                          className="row-action-btn cancel-btn"
                          disabled={opLoading}
                          onClick={() => { setDeletingIdx(null); setOpError(null); }}
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={i}>
                  {columns.map((col) => {
                    const val = row[col];
                    const isNull = val === null || val === undefined;
                    return (
                      <td key={col} className={isNull ? 'null-value' : ''}>
                        {isNull ? 'NULL' : String(val)}
                      </td>
                    );
                  })}
                  {canEdit && (
                    <td className="actions-td">
                      <div className="row-actions">
                        <button
                          className="row-action-btn edit-btn"
                          title="Edit row"
                          onClick={() => startEdit(i)}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          className="row-action-btn delete-btn"
                          title="Delete row"
                          onClick={() => { setDeletingIdx(i); setEditingIdx(null); setOpError(null); }}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4h6v2" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}

            {/* ── New row form ── */}
            {inserting && canEdit && (
              <tr className="inserting-row">
                {columns.map((col, colIdx) => {
                  const isPk = pkColumns.includes(col);
                  const colDef = colDefMap[col];
                  const isNullable = colDef ? !colDef.notnull : true;
                  return (
                    <td key={col} className="edit-cell">
                      <input
                        ref={colIdx === 0 ? firstInsertRef : undefined}
                        className="row-edit-input"
                        type="text"
                        value={insertDraft[col] ?? ''}
                        placeholder={isPk ? 'auto' : isNullable ? 'NULL' : 'required'}
                        onChange={(e) => setInsertDraft((d) => ({ ...d, [col]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveInsert();
                          if (e.key === 'Escape') cancelInsert();
                        }}
                      />
                    </td>
                  );
                })}
                <td className="actions-td">
                  <div className="row-actions row-actions-visible">
                    <button
                      className="row-action-btn save-btn"
                      title="Save row (Enter)"
                      disabled={opLoading}
                      onClick={saveInsert}
                    >
                      {opLoading ? '…' : '✓'}
                    </button>
                    <button
                      className="row-action-btn cancel-btn"
                      title="Cancel (Esc)"
                      disabled={opLoading}
                      onClick={cancelInsert}
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Op error bar ── */}
      {opError && (
        <div className="row-op-error">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {opError}
          <button className="row-op-error-close" onClick={() => setOpError(null)}>✕</button>
        </div>
      )}

      <div className="table-footer">
        <div className="table-footer-left">
          {canEdit && !inserting && (
            <button className="btn btn-sm btn-add-row" onClick={startInsert} title="Insert a new row">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Row
            </button>
          )}
          {canEdit && inserting && (
            <span className="inserting-hint">Fill in the new row above, then press Enter or ✓</span>
          )}

          {hasPagination && onPageChange ? (
            <>
              <button
                className="btn btn-sm"
                disabled={offset === 0}
                onClick={() => handlePageChange(Math.max(0, offset - limit))}
              >
                Previous
              </button>
              <span className="table-footer-page">
                Page {page} of {totalPages}
              </span>
              <button
                className="btn btn-sm"
                disabled={offset + limit >= total!}
                onClick={() => handlePageChange(offset + limit)}
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
              <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>Copied!</>
            ) : 'Copy CSV'}
          </button>
          <button
            className={`btn btn-sm${copyState === 'json' ? ' btn-copy-success' : ''}`}
            onClick={() => triggerCopy('json', toJSON(columns, rows))}
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
