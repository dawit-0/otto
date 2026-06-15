import { useState, useRef } from 'react';
import { type Column } from '../api';

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
  columnDefs?: Column[];
  onCellEdit?: (row: Record<string, unknown>, column: string, value: string | null) => Promise<void>;
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

const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

export default function DataTable({
  columns, rows, total, limit = 100, offset = 0, onPageChange, exportFilename = 'export',
  sortColumn, sortDirection, onSort, columnDefs, onCellEdit, onDeleteRow, onAddRow,
}: Props) {
  const [copyState, setCopyState] = useState<null | 'csv' | 'json'>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingCell, setSavingCell] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [deletingRow, setDeletingRow] = useState<number | null>(null);
  const [showAddRow, setShowAddRow] = useState(false);
  const [newRowValues, setNewRowValues] = useState<Record<string, string>>({});
  const [addingRow, setAddingRow] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  if (columns.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">{'{ }'}</div>
        <div className="empty-state-title">No results</div>
        <div className="empty-state-text">Run a query to see results here.</div>
      </div>
    );
  }

  const columnDefsByName = new Map((columnDefs ?? []).map((c) => [c.name, c]));
  const hasPrimaryKey = (columnDefs ?? []).some((c) => c.pk);
  const canEdit = !!onCellEdit && hasPrimaryKey;
  const canDelete = !!onDeleteRow && hasPrimaryKey;
  const canAdd = !!onAddRow;
  const hasActionsCol = canDelete || canAdd;

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

  const startEdit = (rowIndex: number, col: string, val: unknown) => {
    setEditingCell({ row: rowIndex, col });
    setEditValue(val === null || val === undefined ? '' : String(val));
    setRowError(null);
  };

  const commitEdit = async (rowIndex: number, col: string, setNull: boolean) => {
    if (!onCellEdit) return;
    const row = rows[rowIndex];
    const original = row[col];
    const originalIsNull = original === null || original === undefined;

    if (setNull) {
      if (originalIsNull) {
        setEditingCell(null);
        return;
      }
    } else if (editValue === (originalIsNull ? '' : String(original))) {
      setEditingCell(null);
      return;
    }

    setSavingCell(true);
    setRowError(null);
    try {
      await onCellEdit(row, col, setNull ? null : editValue);
      setEditingCell(null);
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Failed to update cell');
    } finally {
      setSavingCell(false);
    }
  };

  const handleDelete = async (rowIndex: number) => {
    if (!onDeleteRow) return;
    setDeletingRow(rowIndex);
    setRowError(null);
    try {
      await onDeleteRow(rows[rowIndex]);
      setConfirmDelete(null);
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Failed to delete row');
    } finally {
      setDeletingRow(null);
    }
  };

  const openAddRow = () => {
    setNewRowValues({});
    setRowError(null);
    setShowAddRow(true);
  };

  const cancelAddRow = () => {
    setShowAddRow(false);
    setNewRowValues({});
  };

  const submitAddRow = async () => {
    if (!onAddRow) return;
    setAddingRow(true);
    setRowError(null);
    try {
      await onAddRow(newRowValues);
      setShowAddRow(false);
      setNewRowValues({});
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Failed to add row');
    } finally {
      setAddingRow(false);
    }
  };

  return (
    <div className="table-browser">
      {rowError && (
        <div className="filter-error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {rowError}
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
                  {onSort && (
                    <span className="sort-arrow">
                      {sortColumn === col ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅'}
                    </span>
                  )}
                </th>
              ))}
              {hasActionsCol && <th className="row-actions-th"></th>}
            </tr>
          </thead>
          <tbody>
            {showAddRow && (
              <tr className="add-row-form-row">
                {columns.map((col) => {
                  const colDef = columnDefsByName.get(col);
                  const placeholder = colDef?.pk ? 'auto' : colDef?.notnull ? 'required' : 'NULL';
                  return (
                    <td key={col}>
                      <input
                        className="cell-edit-input"
                        placeholder={placeholder}
                        value={newRowValues[col] ?? ''}
                        disabled={addingRow}
                        autoFocus={col === columns[0]}
                        onChange={(e) => setNewRowValues((prev) => ({ ...prev, [col]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submitAddRow();
                          if (e.key === 'Escape') cancelAddRow();
                        }}
                      />
                    </td>
                  );
                })}
                {hasActionsCol && (
                  <td className="row-actions-cell">
                    <span className="row-action-group">
                      <button className="btn-row-action btn-row-confirm" disabled={addingRow} onClick={submitAddRow} title="Save new row">
                        {addingRow ? '…' : '✓'}
                      </button>
                      <button className="btn-row-action" disabled={addingRow} onClick={cancelAddRow} title="Cancel">
                        ✕
                      </button>
                    </span>
                  </td>
                )}
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => {
                  const val = row[col];
                  const isNull = val === null || val === undefined;
                  const isEditing = editingCell?.row === i && editingCell?.col === col;
                  const colDef = columnDefsByName.get(col);

                  if (isEditing) {
                    return (
                      <td key={col} className="cell-editing">
                        <div className="cell-edit-wrap">
                          <input
                            className="cell-edit-input"
                            autoFocus
                            value={editValue}
                            disabled={savingCell}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit(i, col, false);
                              if (e.key === 'Escape') setEditingCell(null);
                            }}
                            onBlur={() => commitEdit(i, col, false)}
                          />
                          {colDef && !colDef.notnull && (
                            <button
                              className="cell-null-btn"
                              title="Set to NULL"
                              disabled={savingCell}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => commitEdit(i, col, true)}
                            >
                              Ø
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  }

                  return (
                    <td
                      key={col}
                      className={`${isNull ? 'null-value' : ''}${canEdit ? ' editable-cell' : ''}`}
                      onDoubleClick={canEdit ? () => startEdit(i, col, val) : undefined}
                      title={canEdit ? 'Double-click to edit' : undefined}
                    >
                      {isNull ? 'NULL' : String(val)}
                    </td>
                  );
                })}
                {hasActionsCol && (
                  <td className="row-actions-cell">
                    {canDelete && (
                      confirmDelete === i ? (
                        <span className="row-action-group">
                          <button
                            className="btn-row-action btn-row-confirm-delete"
                            disabled={deletingRow === i}
                            onClick={() => handleDelete(i)}
                            title="Confirm delete"
                          >
                            {deletingRow === i ? '…' : '✓'}
                          </button>
                          <button
                            className="btn-row-action"
                            disabled={deletingRow === i}
                            onClick={() => setConfirmDelete(null)}
                            title="Cancel"
                          >
                            ✕
                          </button>
                        </span>
                      ) : (
                        <button className="btn-row-action btn-row-delete" onClick={() => setConfirmDelete(i)} title="Delete row">
                          <TrashIcon />
                        </button>
                      )
                    )}
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
          {canAdd && (
            <button
              className={`btn btn-sm${showAddRow ? ' active' : ''}`}
              onClick={() => (showAddRow ? cancelAddRow() : openAddRow())}
              title="Insert a new row"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add row
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
