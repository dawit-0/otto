import { useState, useEffect, useMemo } from 'react';
import { type TableInfo, type FilterRule } from '../api';
import TableBrowser from './TableBrowser';

interface DataViewProps {
  dbId: string;
  tables: TableInfo[];
  selectedTable: string | null;
  onSelectTable: (name: string) => void;
  onClearTable: () => void;
}

interface NavEntry {
  table: string;
  initialFilters: FilterRule[];
  viaFk?: { fromTable: string; fromColumn: string; value: string };
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

// ── BreadcrumbHeader ──────────────────────────────────────────────────────────

interface BreadcrumbHeaderProps {
  navStack: NavEntry[];
  onNavigateTo: (index: number) => void;
  onBackToTables: () => void;
}

function BreadcrumbHeader({ navStack, onNavigateTo, onBackToTables }: BreadcrumbHeaderProps) {
  const current = navStack[navStack.length - 1];

  return (
    <div className="data-view-header">
      <div className="data-view-header-left">
        <button className="data-view-back-btn" onClick={onBackToTables} title="Back to table list">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Tables
        </button>

        {navStack.map((entry, i) => {
          const isLast = i === navStack.length - 1;
          return (
            <span key={`${entry.table}-${i}`} className="breadcrumb-segment">
              <span className="data-view-header-sep">/</span>
              {isLast ? (
                <span className="data-view-header-table">{entry.table}</span>
              ) : (
                <button
                  className="breadcrumb-link"
                  onClick={() => onNavigateTo(i)}
                  title={`Go back to ${entry.table}`}
                >
                  {entry.table}
                </button>
              )}
            </span>
          );
        })}
      </div>

      {current?.viaFk && (
        <div className="data-view-header-right">
          <span className="fk-nav-hint">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            {current.viaFk.fromColumn} = {current.viaFk.value}
          </span>
        </div>
      )}
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
  const [navStack, setNavStack] = useState<NavEntry[]>([]);
  const [navKey, setNavKey] = useState(0);

  // Sync navigation stack when the externally selected table changes
  useEffect(() => {
    if (selectedTable) {
      setNavStack([{ table: selectedTable, initialFilters: [] }]);
    } else {
      setNavStack([]);
    }
    setNavKey((k) => k + 1);
  }, [selectedTable]);

  const currentEntry = navStack[navStack.length - 1] ?? null;

  // Build a map of FK columns for the current table so DataTable can render links
  const fkMap = useMemo(() => {
    if (!currentEntry) return {};
    const tableInfo = tables.find((t) => t.name === currentEntry.table);
    const map: Record<string, { toTable: string; toColumn: string }> = {};
    for (const fk of tableInfo?.foreign_keys ?? []) {
      map[fk.from_column] = { toTable: fk.to_table, toColumn: fk.to_column };
    }
    return map;
  }, [tables, currentEntry?.table]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFkNavigate = (toTable: string, toColumn: string, value: string) => {
    if (!currentEntry) return;
    const filter: FilterRule = {
      id: `fk-${Date.now()}`,
      column: toColumn,
      op: 'equals',
      value,
    };
    setNavStack((prev) => [
      ...prev,
      {
        table: toTable,
        initialFilters: [filter],
        viaFk: { fromTable: currentEntry.table, fromColumn: toColumn, value },
      },
    ]);
    setNavKey((k) => k + 1);
  };

  const handleBreadcrumbNav = (index: number) => {
    setNavStack((prev) => prev.slice(0, index + 1));
    setNavKey((k) => k + 1);
  };

  const handleBackToTables = () => {
    onClearTable();
  };

  const handleSelectTable = (name: string) => {
    onSelectTable(name);
  };

  if (!currentEntry) {
    return <TablePicker tables={tables} onSelect={handleSelectTable} />;
  }

  const columnDefs = tables.find((t) => t.name === currentEntry.table)?.columns ?? [];

  return (
    <div className="data-view">
      <BreadcrumbHeader
        navStack={navStack}
        onNavigateTo={handleBreadcrumbNav}
        onBackToTables={handleBackToTables}
      />
      <TableBrowser
        key={`${dbId}/${currentEntry.table}/${navKey}`}
        dbId={dbId}
        tableName={currentEntry.table}
        columnDefs={columnDefs}
        initialFilters={currentEntry.initialFilters}
        fkMap={Object.keys(fkMap).length > 0 ? fkMap : undefined}
        onFkNavigate={handleFkNavigate}
      />
    </div>
  );
}
