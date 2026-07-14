import { useRef } from 'react';
import { type TableInfo, type FilterRule } from '../api';
import TableBrowser from './TableBrowser';

interface DataViewProps {
  dbId: string;
  tables: TableInfo[];
  selectedTable: string | null;
  onSelectTable: (name: string) => void;
  onClearTable: () => void;
}

// ── TablePicker ───────────────────────────────────────────────────────────────

interface TablePickerProps {
  tables: TableInfo[];
  onSelect: (name: string) => void;
}

function TablePicker({ tables, onSelect }: TablePickerProps) {
  return (
    <div className="data-picker">
      <div className="data-picker-header">
        <span className="data-picker-title">Tables</span>
        <span className="data-picker-count">
          {tables.length} table{tables.length !== 1 ? 's' : ''}
        </span>
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
}: DataViewProps) {
  // Holds filters to pre-seed on the next TableBrowser mount (FK navigation).
  // Using a ref so writing to it doesn't trigger a re-render of DataView.
  const pendingFiltersRef = useRef<FilterRule[]>([]);

  if (!selectedTable) {
    return <TablePicker tables={tables} onSelect={onSelectTable} />;
  }

  const tableInfo = tables.find((t) => t.name === selectedTable);
  const columnDefs = tableInfo?.columns ?? [];
  const foreignKeys = tableInfo?.foreign_keys ?? [];

  // Consume pending filters for this mount; clear ref so they don't repeat.
  const initialFilters = pendingFiltersRef.current;
  pendingFiltersRef.current = [];

  const handleNavigateTo = (targetTable: string, filterCol: string, filterVal: string) => {
    pendingFiltersRef.current = [{
      id: `fk-nav-${Date.now()}`,
      column: filterCol,
      op: 'equals',
      value: filterVal,
    }];
    onSelectTable(targetTable);
  };

  return (
    <div className="data-view">
      <DataViewHeader tableName={selectedTable} onBack={onClearTable} />
      <TableBrowser
        key={`${dbId}/${selectedTable}`}
        dbId={dbId}
        tableName={selectedTable}
        columnDefs={columnDefs}
        foreignKeys={foreignKeys}
        allTables={tables}
        initialFilters={initialFilters}
        onNavigateTo={handleNavigateTo}
      />
    </div>
  );
}
