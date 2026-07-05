import { useState } from 'react';
import { type TableInfo } from '../api';
import TableBrowser from './TableBrowser';
import ImportCSVModal from './ImportCSVModal';

interface DataViewProps {
  dbId: string;
  tables: TableInfo[];
  selectedTable: string | null;
  onSelectTable: (name: string) => void;
  onClearTable: () => void;
  onImportSuccess: () => void;
}

// ── TablePicker ───────────────────────────────────────────────────────────────

interface TablePickerProps {
  dbId: string;
  tables: TableInfo[];
  onSelect: (name: string) => void;
  onImportSuccess: () => void;
}

function TablePicker({ dbId, tables, onSelect, onImportSuccess }: TablePickerProps) {
  const [showImport, setShowImport] = useState(false);

  const handleImportSuccess = (tableName: string) => {
    setShowImport(false);
    onImportSuccess();
    setTimeout(() => onSelect(tableName), 100);
  };

  return (
    <>
      <div className="data-picker">
        <div className="data-picker-header">
          <span className="data-picker-title">Tables</span>
          <div className="data-picker-actions">
            <span className="data-picker-count">
              {tables.length} table{tables.length !== 1 ? 's' : ''}
            </span>
            <button
              className="btn btn-sm"
              title="Import a CSV file as a new table"
              onClick={() => setShowImport(true)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Import CSV
            </button>
          </div>
        </div>
        <div className="data-picker-list">
          {tables.map((table) => (
            <button
              key={table.name}
              className="data-picker-item"
              onClick={() => onSelect(table.name)}
            >
              <span className="data-picker-item-icon">&#9638;</span>
              <span className="data-picker-item-name">{table.name}</span>
              <span className="data-picker-item-meta">
                <span>{table.columns.length} col{table.columns.length !== 1 ? 's' : ''}</span>
                <span className="data-picker-item-sep">·</span>
                <span>{table.row_count.toLocaleString()} row{table.row_count !== 1 ? 's' : ''}</span>
              </span>
            </button>
          ))}
          {tables.length === 0 && (
            <div className="data-picker-empty">No tables found</div>
          )}
        </div>
      </div>
      {showImport && (
        <ImportCSVModal
          dbId={dbId}
          onClose={() => setShowImport(false)}
          onSuccess={handleImportSuccess}
        />
      )}
    </>
  );
}

// ── DataViewHeader ────────────────────────────────────────────────────────────

interface DataViewHeaderProps {
  tableName: string;
  onBack: () => void;
}

function DataViewHeader({ tableName, onBack }: DataViewHeaderProps) {
  return (
    <div className="data-view-header">
      <div className="data-view-header-left">
        <button className="data-view-back-btn" onClick={onBack} title="Back to table list">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Tables
        </button>
        <span className="data-view-header-sep">/</span>
        <span className="data-view-header-table">{tableName}</span>
      </div>
    </div>
  );
}

// ── DataView ──────────────────────────────────────────────────────────────────

export default function DataView({
  dbId,
  tables,
  selectedTable,
  onSelectTable,
  onClearTable,
  onImportSuccess,
}: DataViewProps) {
  if (!selectedTable) {
    return <TablePicker dbId={dbId} tables={tables} onSelect={onSelectTable} onImportSuccess={onImportSuccess} />;
  }

  const columnDefs = tables.find((t) => t.name === selectedTable)?.columns ?? [];

  return (
    <div className="data-view">
      <DataViewHeader tableName={selectedTable} onBack={onClearTable} />
      <TableBrowser
        key={`${dbId}/${selectedTable}`}
        dbId={dbId}
        tableName={selectedTable}
        columnDefs={columnDefs}
      />
    </div>
  );
}
