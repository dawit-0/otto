import { useState } from 'react';
import { type TableInfo } from '../api';
import TableBrowser from './TableBrowser';
import ImportCSVModal from './ImportCSVModal';

interface DataViewProps {
  dbId: string;
  dbType: 'sqlite' | 'postgres';
  tables: TableInfo[];
  selectedTable: string | null;
  onSelectTable: (name: string) => void;
  onClearTable: () => void;
  onImportComplete: () => void;
}

// ── TablePicker ───────────────────────────────────────────────────────────────

interface TablePickerProps {
  dbId: string;
  dbType: 'sqlite' | 'postgres';
  tables: TableInfo[];
  onSelect: (name: string) => void;
  onImportComplete: () => void;
}

function TablePicker({ dbId, dbType, tables, onSelect, onImportComplete }: TablePickerProps) {
  const [showImport, setShowImport] = useState(false);

  return (
    <>
      <div className="data-picker">
        <div className="data-picker-header">
          <span className="data-picker-title">Tables</span>
          <div className="data-picker-header-right">
            <span className="data-picker-count">
              {tables.length} table{tables.length !== 1 ? 's' : ''}
            </span>
            {dbType === 'sqlite' && (
              <button
                className="btn btn-sm csv-import-trigger"
                onClick={() => setShowImport(true)}
                title="Import a CSV file as a new table"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Import CSV
              </button>
            )}
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
            <div className="data-picker-empty">
              No tables found.
              {dbType === 'sqlite' && (
                <button className="csv-empty-import-btn" onClick={() => setShowImport(true)}>
                  Import a CSV to get started
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {showImport && (
        <ImportCSVModal
          dbId={dbId}
          onClose={() => setShowImport(false)}
          onImported={(tableName, rowCount) => {
            setShowImport(false);
            onImportComplete();
            onSelect(tableName);
            // Brief success — the table is now selected and visible
            void rowCount;
          }}
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
  dbType,
  tables,
  selectedTable,
  onSelectTable,
  onClearTable,
  onImportComplete,
}: DataViewProps) {
  if (!selectedTable) {
    return (
      <TablePicker
        dbId={dbId}
        dbType={dbType}
        tables={tables}
        onSelect={onSelectTable}
        onImportComplete={onImportComplete}
      />
    );
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
