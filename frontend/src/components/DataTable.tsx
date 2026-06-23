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
  pkColumns?: string[];
  onCellEdit?: (row: Record<string, unknown>, column: string, newValue: string | null) => Promise<void>;
  onDeleteRow?: (row: Record<string, unknown>) => Promise<void>;
  onAddRow?: (values: Record<string, string>) => Promise<void>;
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

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const XIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export default function DataTable({
  columns, rows, total, limit = 100, offset = 0, onPageChange, exportFilename = 'export',
  sortColumn, sortDirection, onSort, pkColumns, onCellEdit, onDeleteRow, onAddRow,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editable = Boolean(onCellEdit && onDeleteRow && pkColumns && pkColumns.length > 0);

  const [editingCell, setEditingCell] = useState<{ rowIndex: number; column: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [cellSaving, setCellSaving] = useState(false);
  const [cellError, setCellError] = useState<string | null>(null);

  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);
  const confirmDeleteTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [addingRow, setAddingRow] = useState(false);
  const [newRowValues, setNewRowValues] = useState<Record<string, string>>({});
  const [addRowSaving, setAddRowSaving] = useState(false);
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

  const startEdit = (rowIndex: number, column: string, currentValue: unknown) => {
    if (!editable) return;
    setCellError(null);
    setEditingCell({ rowIndex, column });
    setEditValue(currentValue === null || currentValue === undefined ? '' : String(currentValue));
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setCellError(null);
  };

  const commitEdit = async () => {
    if (!editingCell || !onCellEdit) return;
    const row = rows[editingCell.rowIndex];
    const column = editingCell.column;
    const original = row[column];
    const originalStr = original === null || original === undefined ? '' : String(original);
    if (editValue === originalStr) {
      cancelEdit();
      return;
    }
    setCellSaving(true);
    setCellError(null);
    try {
      await onCellEdit(row, column, editValue === '' ? null : editValue);
      setEditingCell(null);
    } catch (e) {
      setCellError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setCellSaving(false);
    }
  };

  const requestDelete = (rowIndex: number) => {
    setDeleteError(null);
    if (confirmDeleteIndex === rowIndex) {
      if (confirmDeleteTimeout.current) clearTimeout(confirmDeleteTimeout.current);
      setConfirmDeleteIndex(null);
      void doDelete(rowIndex);
      return;
    }
    setConfirmDeleteIndex(rowIndex);
    if (confirmDeleteTimeout.current) clearTimeout(confirmDeleteTimeout.current);
    confirmDeleteTimeout.current = setTimeout(() => setConfirmDeleteIndex(null), 3000);
  };

  const doDelete = async (rowIndex: number) => {
    if (!onDeleteRow) return;
    setDeletingIndex(rowIndex);
    setDeleteError(null);
    try {
      await onDeleteRow(rows[rowIndex]);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete row');
    } finally {
      setDeletingIndex(null);
    }
  };

  const openAddRow = () => {
    setNewRowValues({});
    setAddRowError(null);
    setAddingRow(true);
  };

  const cancelAddRow = () => {
    setAddingRow(false);
    setNewRowValues({});
    setAddRowError(null);
  };

  const commitAddRow = async () => {
    if (!onAddRow) return;
    setAddRowSaving(true);
    setAddRowError(null);
    try {
      await onAddRow(newRowValues);
      setAddingRow(false);
      setNewRowValues({});
    } catch (e) {
      setAddRowError(e instanceof Error ? e.message : 'Failed to add row');
    } finally {
      setAddRowSaving(false);
    }
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
                  {col}
                  {pkColumns?.includes(col) && <span className="pk-indicator" title="Primary key">🔑</span>}
                  {onSort && (
                    <span className="sort-arrow">
                      {sortColumn === col ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅'}
                    </span>
                  )}
                </th>
              ))}
              {editable && <th className="row-actions-th" />}
            </tr>
          </thead>
          <tbody>
            {addingRow && (
              <tr className="add-row-row">
                {columns.map((col) => (
                  <td key={col}>
                    <input
                      className="cell-edit-input"
                      value={newRowValues[col] ?? ''}
                      onChange={(e) => setNewRowValues((prev) => ({ ...prev, [col]: e.target.value }))}
                      placeholder={pkColumns?.includes(col) ? 'auto' : 'NULL'}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitAddRow();
                        if (e.key === 'Escape') cancelAddRow();
                      }}
                      disabled={addRowSaving}
                      autoFocus={col === columns[0]}
                    />
                  </td>
                ))}
                <td className="row-actions-cell">
                  <button className="btn-icon" onClick={commitAddRow} disabled={addRowSaving} title="Save new row">
                    <CheckIcon />
                  </button>
                  <button className="btn-icon" onClick={cancelAddRow} disabled={addRowSaving} title="Cancel">
                    <XIcon />
                  </button>
                </td>
              </tr>
            )}
            {addingRow && addRowError && (
              <tr className="add-row-error-row">
                <td colSpan={columns.length + 1} className="cell-error">{addRowError}</td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => {
                  const val = row[col];
                  const isNull = val === null || val === undefined;
                  const isEditing = editingCell?.rowIndex === i && editingCell?.column === col;
                  if (isEditing) {
                    return (
                      <td key={col} className="cell-editing-td">
                        <input
                          className="cell-edit-input"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit();
                            if (e.key === 'Escape') cancelEdit();
                          }}
                          onBlur={commitEdit}
                          disabled={cellSaving}
                          autoFocus
                        />
                        {cellError && <div className="cell-error">{cellError}</div>}
                      </td>
                    );
                  }
                  return (
                    <td
                      key={col}
                      className={`${isNull ? 'null-value' : ''}${editable ? ' editable-cell' : ''}`}
                      onDoubleClick={() => startEdit(i, col, val)}
                      title={editable ? 'Double-click to edit' : undefined}
                    >
                      {isNull ? 'NULL' : String(val)}
                    </td>
                  );
                })}
                {editable && (
                  <td className="row-actions-cell">
                    <button
                      className={`btn-icon btn-icon-delete${confirmDeleteIndex === i ? ' confirm-delete' : ''}`}
                      onClick={() => requestDelete(i)}
                      disabled={deletingIndex === i}
                      title={confirmDeleteIndex === i ? 'Click again to confirm' : 'Delete row'}
                    >
                      <TrashIcon />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {deleteError && <div className="cell-error" style={{ padding: '8px 14px' }}>{deleteError}</div>}
      </div>

      <div className="table-footer">
        <div className="table-footer-left">
          {editable && (
            <button className="btn btn-sm" onClick={openAddRow} disabled={addingRow} title="Insert a new row">
              <PlusIcon />
              Add Row
            </button>
          )}
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
                <CheckIcon />
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
                <CheckIcon />
                Copied!
              </>
            ) : 'Copy JSON'}
          </button>
        </div>
      </div>
    </div>
  );
}
