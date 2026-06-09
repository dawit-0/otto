import { useState } from 'react';
import { type TableInfo, type FilterRule } from '../api';
import TableBrowser from './TableBrowser';

interface DataViewProps {
  dbId: string;
  tables: TableInfo[];
  selectedTable: string | null;
  onSelectTable: (name: string) => void;
  onClearTable: () => void;
}

type NavFrame = {
  tableName: string;
};

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

// ── Breadcrumb ────────────────────────────────────────────────────────────────

interface BreadcrumbProps {
  stack: NavFrame[];
  currentTable: string;
  onNavigateToFrame: (index: number) => void;
  onRoot: () => void;
}

function Breadcrumb({ stack, currentTable, onNavigateToFrame, onRoot }: BreadcrumbProps) {
  return (
    <div className="nav-breadcrumb">
      <button className="nav-breadcrumb-item nav-breadcrumb-root" onClick={onRoot}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
        </svg>
        Tables
      </button>
      {stack.map((frame, i) => (
        <span key={i} className="nav-breadcrumb-segment">
          <span className="nav-breadcrumb-sep">›</span>
          <button className="nav-breadcrumb-item" onClick={() => onNavigateToFrame(i)}>
            {frame.tableName}
          </button>
        </span>
      ))}
      <span className="nav-breadcrumb-sep">›</span>
      <span className="nav-breadcrumb-item nav-breadcrumb-current">{currentTable}</span>
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
  const [navStack, setNavStack] = useState<NavFrame[]>([]);
  const [entryFilters, setEntryFilters] = useState<FilterRule[]>([]);

  const handleSelectFromPicker = (name: string) => {
    setNavStack([]);
    setEntryFilters([]);
    onSelectTable(name);
  };

  if (!selectedTable) {
    return <TablePicker tables={tables} onSelect={handleSelectFromPicker} />;
  }

  const tableInfo = tables.find((t) => t.name === selectedTable);
  const columnDefs = tableInfo?.columns ?? [];
  const foreignKeys = tableInfo?.foreign_keys ?? [];

  const handleFkClick = (toTable: string, toColumn: string, value: unknown) => {
    setNavStack((prev) => [...prev, { tableName: selectedTable }]);
    setEntryFilters([
      {
        id: `fk-nav-${Date.now()}`,
        column: toColumn,
        op: 'equals',
        value: String(value),
      },
    ]);
    onSelectTable(toTable);
  };

  const handleNavigateToFrame = (index: number) => {
    const target = navStack[index];
    setNavStack((prev) => prev.slice(0, index));
    setEntryFilters([]);
    onSelectTable(target.tableName);
  };

  const handleRoot = () => {
    setNavStack([]);
    setEntryFilters([]);
    onClearTable();
  };

  return (
    <div className="data-view">
      <Breadcrumb
        stack={navStack}
        currentTable={selectedTable}
        onNavigateToFrame={handleNavigateToFrame}
        onRoot={handleRoot}
      />
      <TableBrowser
        key={`${dbId}/${selectedTable}/${navStack.length}`}
        dbId={dbId}
        tableName={selectedTable}
        columnDefs={columnDefs}
        foreignKeys={foreignKeys}
        initialFilters={entryFilters}
        onFkClick={handleFkClick}
      />
    </div>
  );
}
