import { useState } from 'react';
import { type ColumnFilter } from '../api';

type FilterOp = 'eq' | 'neq' | 'contains' | 'startswith' | 'endswith' | 'gt' | 'lt' | 'gte' | 'lte' | 'isnull' | 'notnull';

const OP_LABELS: Record<FilterOp, string> = {
  eq: '=',
  neq: '≠',
  contains: 'contains',
  startswith: 'starts with',
  endswith: 'ends with',
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
  isnull: 'is null',
  notnull: 'is not null',
};

const NO_VALUE_OPS = new Set<FilterOp>(['isnull', 'notnull']);

interface Props {
  columns: string[];
  search: string;
  filters: ColumnFilter[];
  onSearchChange: (search: string) => void;
  onAddFilter: (filter: ColumnFilter) => void;
  onRemoveFilter: (index: number) => void;
  onClearAll: () => void;
}

export default function FilterBar({ columns, search, filters, onSearchChange, onAddFilter, onRemoveFilter, onClearAll }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [draftCol, setDraftCol] = useState(columns[0] ?? '');
  const [draftOp, setDraftOp] = useState<FilterOp>('contains');
  const [draftVal, setDraftVal] = useState('');

  const needsValue = !NO_VALUE_OPS.has(draftOp);

  const handleAdd = () => {
    if (!draftCol) return;
    if (needsValue && !draftVal.trim()) return;
    onAddFilter({ col: draftCol, op: draftOp, val: needsValue ? draftVal.trim() : '' });
    setDraftVal('');
    setShowForm(false);
  };

  const chipLabel = (f: ColumnFilter) => {
    const label = OP_LABELS[f.op as FilterOp] ?? f.op;
    if (NO_VALUE_OPS.has(f.op as FilterOp)) return `${f.col} ${label}`;
    return `${f.col} ${label} "${f.val}"`;
  };

  const hasActive = search.length > 0 || filters.length > 0;

  return (
    <div className="filter-bar">
      <div className="filter-bar-row">
        <div className="filter-search-wrap">
          <svg className="filter-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="filter-search-input"
            type="text"
            placeholder="Search all columns..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {search && (
            <button className="filter-clear-x" onClick={() => onSearchChange('')} title="Clear search">
              ×
            </button>
          )}
        </div>

        <button
          className={`btn btn-sm${showForm ? ' btn-history-active' : ''}`}
          onClick={() => {
            setDraftCol(columns[0] ?? '');
            setDraftVal('');
            setShowForm((v) => !v);
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="8" y1="12" x2="16" y2="12" />
            <line x1="11" y1="18" x2="13" y2="18" />
          </svg>
          Filter
        </button>

        {hasActive && (
          <button className="btn btn-sm" style={{ color: 'var(--text-muted)' }} onClick={onClearAll}>
            Clear all
          </button>
        )}
      </div>

      {showForm && (
        <div className="filter-form">
          <select
            className="filter-select"
            value={draftCol}
            onChange={(e) => setDraftCol(e.target.value)}
          >
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            className="filter-select"
            value={draftOp}
            onChange={(e) => setDraftOp(e.target.value as FilterOp)}
          >
            {(Object.entries(OP_LABELS) as [FilterOp, string][]).map(([op, label]) => (
              <option key={op} value={op}>{label}</option>
            ))}
          </select>

          {needsValue && (
            <input
              className="filter-val-input"
              type="text"
              placeholder="Value..."
              value={draftVal}
              onChange={(e) => setDraftVal(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              autoFocus
            />
          )}

          <button className="btn btn-sm btn-primary" onClick={handleAdd}>
            Apply
          </button>
          <button className="btn btn-sm" onClick={() => setShowForm(false)}>
            Cancel
          </button>
        </div>
      )}

      {filters.length > 0 && (
        <div className="filter-chips">
          {filters.map((f, i) => (
            <span key={i} className="filter-chip">
              <span className="filter-chip-col">{f.col}</span>
              <span className="filter-chip-op">{OP_LABELS[f.op as FilterOp] ?? f.op}</span>
              {!NO_VALUE_OPS.has(f.op as FilterOp) && (
                <span className="filter-chip-val">"{f.val}"</span>
              )}
              <button
                className="filter-chip-remove"
                onClick={() => onRemoveFilter(i)}
                title={`Remove: ${chipLabel(f)}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
