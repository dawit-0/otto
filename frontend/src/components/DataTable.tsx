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
  /** Columns that make up the table's primary key. Required for cell editing
   * and row deletion, since updates/deletes are matched by primary key. */
  primaryKeyColumns?: string[];
  onUpdateCell?: (row: Record<string, unknown>, column: string, value: string) => Promise<void>;
  onDeleteRow?: (row: Record<string, unknown>) => Promise<void>;
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

export default function DataTable({
  columns, rows, total, limit = 100, offset = 0, onPageChange, exportFilename = 'export',
  sortColumn, sortDirection, onSort,
  primaryKeyColumns, onUpdateCell, onDeleteRow, onInsertRow,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingCell, setSavingCell] = useState(false);
  const [deletingRow, setDeletingRow] = useState<number | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const [addingRow, setAddingRow] = useState(false);
  const [newRowValues, setNewRowValues] = useState<Record<string, string>>({});
  const [insertSaving, setInsertSaving] = useState(false);

  if (columns.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">{'{ }'}</div>
        <div className="empty-state-title">No results</div>
        <div className="empty-state-text">Run a query to see results here.</div>
      </div>
    );
  }

  const canEditCells = !!onUpdateCell && (primaryKeyColumns?.length ?? 0) > 0;
  const canDeleteRows = canEditCells && !!onDeleteRow;
  const canInsertRows = !!onInsertRow;
  const showActionsColumn = canDeleteRows;

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

  const startCellEdit = (rowIdx: number, col: string, val: unknown) => {
    setMutationError(null);
    setEditingCell({ row: rowIdx, col });
    setEditValue(val === null || val === undefined ? '' : String(val));
  };

  const cancelCellEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const commitCellEdit = async (rowIdx: number, col: string, row: Record<string, unknown>) => {
    if (savingCell) return;
    if (!editingCell || editingCell.row !== rowIdx || editingCell.col !== col) return;
    const original = row[col];
    const originalStr = original === null || original === undefined ? '' : String(original);
    if (editValue === originalStr) {
      cancelCellEdit();
      return;
    }
    if (!onUpdateCell) {
      cancelCellEdit();
      return;
    }
    setSavingCell(true);
    try {
      await onUpdateCell(row, col, editValue);
      cancelCellEdit();
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : 'Failed to update cell');
    } finally {
      setSavingCell(false);
    }
  };

  const handleDeleteRow = async (rowIdx: number, row: Record<string, unknown>) => {
    if (!onDeleteRow) return;
    if (!window.confirm('Delete this row? This cannot be undone.')) return;
    setMutationError(null);
    setDeletingRow(rowIdx);
    try {
      await onDeleteRow(row);
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : 'Failed to delete row');
    } finally {
      setDeletingRow(null);
    }
  };

  const startAddRow = () => {
    setMutationError(null);
    setNewRowValues({});
    setAddingRow(true);
  };

  const cancelAddRow = () => {
    setAddingRow(false);
    setNewRowValues({});
  };

  const submitAddRow = async () => {
    if (!onInsertRow) return;
    setInsertSaving(true);
    try {
      const values: Record<string, string> = {};
      for (const col of columns) {
        const v = newRowValues[col];
        if (v !== undefined && v !== '') values[col] = v;
      }
      await onInsertRow(values);
      cancelAddRow();
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : 'Failed to insert row');
    } finally {
      setInsertSaving(false);
    }
  };

  return (
    <div className="table-browser">
      {mutationError && (
        <div className="filter-error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {mutationError}
          <button className="filter-error-dismiss" onClick={() => setMutationError(null)}>&times;</button>
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
                  {primaryKeyColumns?.includes(col) && <span className="pk-badge" title="Primary key">PK</span>}
                  {onSort && (
                    <span className="sort-arrow">
                      {sortColumn === col ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅'}
                    </span>
                  )}
                </th>
              ))}
              {showActionsColumn && <th className="actions-th" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => {
                  const val = row[col];
                  const isNull = val === null || val === undefined;
                  const isPk = primaryKeyColumns?.includes(col) ?? false;
                  const isEditingThis = editingCell?.row === i && editingCell?.col === col;
                  const editableHere = canEditCells && !isPk;

                  if (isEditingThis) {
                    return (
                      <td key={col} className="cell-editing">
                        <input
                          autoFocus
                          className="cell-edit-input"
                          value={editValue}
                          disabled={savingCell}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitCellEdit(i, col, row);
                            if (e.key === 'Escape') cancelCellEdit();
                          }}
                          onBlur={() => commitCellEdit(i, col, row)}
                        />
                      </td>
                    );
                  }

                  return (
                    <td
                      key={col}
                      className={`${isNull ? 'null-value' : ''}${editableHere ? ' cell-editable' : ''}`}
                      title={editableHere ? 'Double-click to edit' : undefined}
                      onDoubleClick={editableHere ? () => startCellEdit(i, col, val) : undefined}
                    >
                      {isNull ? 'NULL' : String(val)}
                    </td>
                  );
                })}
                {showActionsColumn && (
                  <td className="row-actions-cell">
                    <button
                      className="btn-icon-danger"
                      title="Delete row"
                      disabled={deletingRow === i}
                      onClick={() => handleDeleteRow(i, row)}
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

            {canInsertRows && addingRow && (
              <tr className="add-row-form-row">
                {columns.map((col) => (
                  <td key={col}>
                    <input
                      className="add-row-input"
                      placeholder={primaryKeyColumns?.includes(col) ? 'auto' : col}
                      value={newRowValues[col] ?? ''}
                      disabled={insertSaving}
                      onChange={(e) => setNewRowValues((prev) => ({ ...prev, [col]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitAddRow();
                        if (e.key === 'Escape') cancelAddRow();
                      }}
                    />
                  </td>
                ))}
                <td className="row-actions-cell add-row-actions">
                  <button className="btn-icon" title="Save row" disabled={insertSaving} onClick={submitAddRow}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                  <button className="btn-icon" title="Cancel" disabled={insertSaving} onClick={cancelAddRow}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </td>
              </tr>
            )}

            {canInsertRows && !addingRow && (
              <tr className="add-row-trigger-row">
                <td colSpan={columns.length + (showActionsColumn ? 1 : 0)} onClick={startAddRow}>
                  <span className="add-row-trigger">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Add row
                  </span>
                </td>
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
