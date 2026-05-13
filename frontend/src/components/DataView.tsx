import { type TableInfo } from '../api';
import DataTable from './DataTable';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DataViewOptions {
  // Extensible: add sort, filters, column visibility, etc. here
}

interface DataViewProps {
  tables: TableInfo[];
  selectedTable: string | null;
  tableData: { columns: string[]; rows: Record<string, unknown>[]; total: number } | null;
  dataOffset: number;
  limit: number;
  options?: DataViewOptions;
  onSelectTable: (name: string) => void;
  onClearTable: () => void;
  onPageChange: (offset: number) => void;
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
  total: number;
  onBack: () => void;
}

function DataViewHeader({ tableName, total, onBack }: DataViewHeaderProps) {
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
      <span className="data-view-header-info">{total.toLocaleString()} rows</span>
    </div>
  );
}

// ── DataView ──────────────────────────────────────────────────────────────────

export default function DataView({
  tables,
  selectedTable,
  tableData,
  dataOffset,
  limit,
  onSelectTable,
  onClearTable,
  onPageChange,
}: DataViewProps) {
  if (!selectedTable) {
    return <TablePicker tables={tables} onSelect={onSelectTable} />;
  }

  if (!tableData) {
    return (
      <div className="empty-state">
        <div className="empty-state-text">Loading…</div>
      </div>
    );
  }

  return (
    <div className="data-view">
      <DataViewHeader
        tableName={selectedTable}
        total={tableData.total}
        onBack={onClearTable}
      />
      <DataTable
        columns={tableData.columns}
        rows={tableData.rows}
        total={tableData.total}
        limit={limit}
        offset={dataOffset}
        onPageChange={onPageChange}
        exportFilename={selectedTable}
      />
    </div>
  );
}
