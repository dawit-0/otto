import { useState, useRef, useEffect } from 'react';

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
  editable?: boolean;
  onUpdateCell?: (rowIndex: number, column: string, value: string | null) => Promise<void>;
  onDeleteRow?: (rowIndex: number) => Promise<void>;
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
}

export default function DataTable({
  columns, rows, total, limit = 100, offset = 0, onPageChange, exportFilename = 'export',
  sortColumn, sortDirection, onSort, editable = false, onUpdateCell, onDeleteRow,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [draftIsNull, setDraftIsNull] = useState(false);
  const [savingCell, setSavingCell] = useState(false);
  const [cellError, setCellError] = useState<string | null>(null);

  const [confirmDeleteRow, setConfirmDeleteRow] = useState<number | null>(null);
  const [deletingRow, setDeletingRow] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingCell) inputRef.current?.focus();
  }, [editingCell]);

  // rowIndex addresses a position in `rows`, which can shift out from under an
  // open editor if the data reloads for an unrelated reason (e.g. another row
  // is deleted/added). Discard any in-progress edit rather than risk committing
  // to the wrong row.
  const prevRows = useRef(rows);
  useEffect(() => {
    if (prevRows.current !== rows) {
      setEditingCell(null);
      setConfirmDeleteRow(null);
    }
    prevRows.current = rows;
  }, [rows]);

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

  const startEdit = (rowIndex: number, col: string) => {
    if (!editable || savingCell) return;
    const val = rows[rowIndex][col];
    const isNull = val === null || val === undefined;
    setEditingCell({ rowIndex, column: col });
    setDraftValue(isNull ? '' : String(val));
    setDraftIsNull(isNull);
    setCellError(null);
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setCellError(null);
  };

  const commitEdit = async () => {
    if (!editingCell || !onUpdateCell) return;
    const { rowIndex, column } = editingCell;
    const original = rows[rowIndex][column];
    const originalIsNull = original === null || original === undefined;
    const newValue = draftIsNull ? null : draftValue;
    const unchanged = draftIsNull ? originalIsNull : !originalIsNull && String(original) === draftValue;
    if (unchanged) {
      cancelEdit();
      return;
    }
    setSavingCell(true);
    setCellError(null);
    try {
      await onUpdateCell(rowIndex, column, newValue);
      setEditingCell(null);
    } catch (e) {
      setCellError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSavingCell(false);
    }
  };

  const handleDeleteRow = async (rowIndex: number) => {
    if (!onDeleteRow) return;
    setDeletingRow(rowIndex);
    try {
      await onDeleteRow(rowIndex);
      setConfirmDeleteRow(null);
    } catch {
      // Row stays in place; TableBrowser surfaces the error via its own state.
    } finally {
      setDeletingRow(null);
    }
  };

  return (
    <div className="table-browser">
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              {editable && <th className="row-actions-th" />}
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
            {rows.map((row, i) => (
              <tr key={i} className={deletingRow === i ? 'row-deleting' : ''}>
                {editable && (
                  <td className="row-actions-td">
                    {confirmDeleteRow === i ? (
                      <div className="row-delete-confirm">
                        <span>Delete?</span>
                        <button
                          className="row-delete-confirm-yes"
                          disabled={deletingRow === i}
                          onClick={() => handleDeleteRow(i)}
                        >
                          {deletingRow === i ? '…' : 'Yes'}
                        </button>
                        <button
                          className="row-delete-confirm-no"
                          onClick={() => setConfirmDeleteRow(null)}
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        className="row-delete-btn"
                        title="Delete row"
                        onClick={() => setConfirmDeleteRow(i)}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </td>
                )}
                {columns.map((col) => {
                  const isEditing = editingCell?.rowIndex === i && editingCell?.column === col;
                  if (isEditing) {
                    return (
                      <td key={col} className="editing-cell">
                        <div className="cell-edit-wrap">
                          <input
                            ref={inputRef}
                            className="cell-edit-input"
                            value={draftIsNull ? '' : draftValue}
                            readOnly={draftIsNull || savingCell}
                            placeholder={draftIsNull ? 'NULL' : ''}
                            onChange={(e) => setDraftValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                              if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                            }}
                          />
                          <button
                            type="button"
                            className={`cell-null-toggle${draftIsNull ? ' active' : ''}`}
                            title="Toggle NULL"
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => setDraftIsNull((v) => !v)}
                          >
                            ∅
                          </button>
                        </div>
                        {cellError && <div className="cell-edit-error">{cellError}</div>}
                      </td>
                    );
                  }
                  const val = row[col];
                  const isNull = val === null || val === undefined;
                  return (
                    <td
                      key={col}
                      className={isNull ? 'null-value' : ''}
                      onDoubleClick={editable ? () => startEdit(i, col) : undefined}
                    >
                      {isNull ? 'NULL' : String(val)}
                    </td>
                  );
                })}
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
