import { useState, useRef, Fragment } from 'react';

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
  onUpdateCell?: (row: Record<string, unknown>, column: string, value: unknown) => Promise<void>;
  onDeleteRow?: (row: Record<string, unknown>) => Promise<void>;
  onInsertRow?: (values: Record<string, unknown>) => Promise<void>;
}

interface EditingCell {
  row: number;
  col: string;
}

interface RowMessage {
  row: number;
  message: string;
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
  editable = false, onUpdateCell, onDeleteRow, onInsertRow,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingCell, setSavingCell] = useState<EditingCell | null>(null);
  const [cellError, setCellError] = useState<RowMessage | null>(null);

  const [confirmDeleteRow, setConfirmDeleteRow] = useState<number | null>(null);
  const [deletingRow, setDeletingRow] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<RowMessage | null>(null);

  const [addingRow, setAddingRow] = useState(false);
  const [newRowValues, setNewRowValues] = useState<Record<string, string>>({});
  const [savingNewRow, setSavingNewRow] = useState(false);
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
    if (!editable || !onUpdateCell) return;
    if (savingCell || addingRow) return;
    setCellError(null);
    setEditingCell({ row: rowIndex, col });
    setEditValue(value === null || value === undefined ? '' : String(value));
  };

  const cancelEdit = () => setEditingCell(null);

  const commitEdit = async () => {
    if (!editingCell || !onUpdateCell) return;
    const { row: rowIndex, col } = editingCell;
    const row = rows[rowIndex];
    const original = row[col];
    const originalStr = original === null || original === undefined ? '' : String(original);

    if (editValue === originalStr) {
      setEditingCell(null);
      return;
    }

    const value: unknown = editValue.trim() === '' ? null : editValue;
    setSavingCell({ row: rowIndex, col });
    setEditingCell(null);
    try {
      await onUpdateCell(row, col, value);
      setCellError(null);
    } catch (e) {
      setCellError({ row: rowIndex, message: e instanceof Error ? e.message : 'Failed to update cell' });
    } finally {
      setSavingCell(null);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  };

  const requestDelete = (rowIndex: number) => {
    setDeleteError(null);
    setConfirmDeleteRow(rowIndex);
  };

  const confirmDelete = async (rowIndex: number) => {
    if (!onDeleteRow) return;
    setDeletingRow(rowIndex);
    try {
      await onDeleteRow(rows[rowIndex]);
      setConfirmDeleteRow(null);
    } catch (e) {
      setDeleteError({ row: rowIndex, message: e instanceof Error ? e.message : 'Failed to delete row' });
    } finally {
      setDeletingRow(null);
    }
  };

  const openAddRow = () => {
    setAddingRow(true);
    setNewRowValues({});
    setAddRowError(null);
  };

  const cancelAddRow = () => {
    setAddingRow(false);
    setNewRowValues({});
    setAddRowError(null);
  };

  const saveNewRow = async () => {
    if (!onInsertRow) return;
    setSavingNewRow(true);
    setAddRowError(null);
    try {
      const values: Record<string, unknown> = {};
      for (const col of columns) {
        const v = newRowValues[col];
        if (v !== undefined && v.trim() !== '') values[col] = v;
      }
      await onInsertRow(values);
      setAddingRow(false);
      setNewRowValues({});
    } catch (e) {
      setAddRowError(e instanceof Error ? e.message : 'Failed to add row');
    } finally {
      setSavingNewRow(false);
    }
  };

  const handleNewRowKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); saveNewRow(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelAddRow(); }
  };

  const colSpan = columns.length + (editable ? 1 : 0);

  return (
    <div className="table-browser">
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              {editable && <th className="row-actions-th"></th>}
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
            {addingRow && (
              <Fragment>
                <tr className="new-row">
                  <td className="row-actions-td">
                    <button
                      className="btn-icon btn-icon-confirm"
                      onClick={saveNewRow}
                      disabled={savingNewRow}
                      title="Save row"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                    <button className="btn-icon" onClick={cancelAddRow} disabled={savingNewRow} title="Cancel">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </td>
                  {columns.map((col) => (
                    <td key={col} className="cell-editing">
                      <input
                        className="cell-input"
                        value={newRowValues[col] ?? ''}
                        placeholder="NULL"
                        onChange={(e) => setNewRowValues((prev) => ({ ...prev, [col]: e.target.value }))}
                        onKeyDown={handleNewRowKeyDown}
                        disabled={savingNewRow}
                      />
                    </td>
                  ))}
                </tr>
                {addRowError && (
                  <tr className="row-message-row">
                    <td colSpan={colSpan} className="row-message-cell error">{addRowError}</td>
                  </tr>
                )}
              </Fragment>
            )}
            {rows.map((row, i) => (
              <Fragment key={i}>
                <tr>
                  {editable && (
                    <td className="row-actions-td">
                      {confirmDeleteRow === i ? (
                        <span className="row-delete-confirm">
                          <button
                            className="btn-icon btn-icon-danger"
                            onClick={() => confirmDelete(i)}
                            disabled={deletingRow === i}
                            title="Confirm delete"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </button>
                          <button
                            className="btn-icon"
                            onClick={() => setConfirmDeleteRow(null)}
                            disabled={deletingRow === i}
                            title="Cancel"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </span>
                      ) : (
                        <button
                          className="btn-icon row-delete-btn"
                          onClick={() => requestDelete(i)}
                          title="Delete row"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      )}
                    </td>
                  )}
                  {columns.map((col) => {
                    const val = row[col];
                    const isNull = val === null || val === undefined;
                    const isEditing = editingCell?.row === i && editingCell.col === col;
                    const isSaving = savingCell?.row === i && savingCell.col === col;

                    if (isEditing) {
                      return (
                        <td key={col} className="cell-editing">
                          <input
                            className="cell-input"
                            value={editValue}
                            placeholder="NULL"
                            autoFocus
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={handleEditKeyDown}
                          />
                        </td>
                      );
                    }

                    return (
                      <td
                        key={col}
                        className={`${isNull ? 'null-value' : ''}${editable ? ' cell-editable' : ''}${isSaving ? ' cell-saving' : ''}`}
                        onDoubleClick={() => startEdit(i, col, val)}
                        title={editable ? 'Double-click to edit' : undefined}
                      >
                        {isSaving ? 'Saving…' : (isNull ? 'NULL' : String(val))}
                      </td>
                    );
                  })}
                </tr>
                {cellError?.row === i && (
                  <tr className="row-message-row">
                    <td colSpan={colSpan} className="row-message-cell error">{cellError.message}</td>
                  </tr>
                )}
                {deleteError?.row === i && (
                  <tr className="row-message-row">
                    <td colSpan={colSpan} className="row-message-cell error">{deleteError.message}</td>
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
          {editable && onInsertRow && (
            <button
              className="btn btn-sm"
              onClick={openAddRow}
              disabled={addingRow}
              title="Insert a new row"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Row
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
