import { useState, useMemo } from 'react';
import type { TableInfo } from '../api';

interface Props {
  tables: TableInfo[];
  onInsert: (text: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

const TYPE_ABBREV: [RegExp, string][] = [
  [/INT/i, 'int'],
  [/TEXT|CHAR|CLOB/i, 'str'],
  [/REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL/i, 'flt'],
  [/BOOL/i, 'bool'],
  [/DATE|TIME/i, 'date'],
  [/BLOB/i, 'blob'],
  [/JSON/i, 'json'],
];

function shortType(type: string): string {
  for (const [re, label] of TYPE_ABBREV) {
    if (re.test(type)) return label;
  }
  return type ? type.slice(0, 4).toLowerCase() : 'any';
}

export default function SchemaPanel({ tables, onInsert, isOpen, onToggle }: Props) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter(
      (t) => t.name.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q)),
    );
  }, [tables, search]);

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  if (!isOpen) {
    return (
      <div className="schema-panel schema-panel--collapsed">
        <button className="schema-panel-toggle-btn" onClick={onToggle} title="Open schema browser">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
          <span className="schema-panel-toggle-label">Schema</span>
        </button>
      </div>
    );
  }

  return (
    <div className="schema-panel">
      <div className="schema-panel__header">
        <span className="schema-panel__title">Schema</span>
        <button className="btn-icon" onClick={onToggle} title="Collapse schema panel">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      <div className="schema-panel__search-wrap">
        <svg className="schema-panel__search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          className="schema-panel__search"
          placeholder="Filter tables & columns…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="schema-panel__search-clear" onClick={() => setSearch('')}>
            ×
          </button>
        )}
      </div>

      <div className="schema-panel__list">
        {filtered.length === 0 && (
          <div className="schema-panel__empty">No tables match</div>
        )}
        {filtered.map((table) => {
          const isExpanded = expanded.has(table.name);
          const fkCols = new Set(table.foreign_keys.map((fk) => fk.from_column));

          return (
            <div key={table.name} className="schema-table">
              <div className={`schema-table__row${isExpanded ? ' schema-table__row--open' : ''}`}>
                <button
                  className="schema-table__expand"
                  onClick={() => toggle(table.name)}
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                >
                  <svg
                    className={`schema-table__chevron${isExpanded ? ' schema-table__chevron--open' : ''}`}
                    width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                    strokeLinecap="round" strokeLinejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                <button
                  className="schema-table__name-btn"
                  onClick={() => toggle(table.name)}
                  title={`${table.name} · ${table.row_count.toLocaleString()} rows`}
                >
                  <svg className="schema-table__icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="3" y1="15" x2="21" y2="15" />
                    <line x1="9" y1="9" x2="9" y2="21" />
                  </svg>
                  <span className="schema-table__name">{table.name}</span>
                </button>

                <span className="schema-table__count">{table.row_count.toLocaleString()}</span>

                <button
                  className="schema-table__insert-btn"
                  onClick={() => onInsert(table.name)}
                  title={`Insert "${table.name}" at cursor`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>

              {isExpanded && (
                <div className="schema-columns">
                  {table.columns.map((col) => {
                    const isPK = col.pk;
                    const isFK = fkCols.has(col.name);
                    return (
                      <button
                        key={col.name}
                        className="schema-col"
                        onClick={() => onInsert(col.name)}
                        title={`Insert "${col.name}" (${col.type || 'any'})`}
                      >
                        <span className={`schema-col__dot${isPK ? ' schema-col__dot--pk' : isFK ? ' schema-col__dot--fk' : ''}`} />
                        <span className="schema-col__name">{col.name}</span>
                        <span className={`schema-col__type${isPK ? ' schema-col__type--pk' : isFK ? ' schema-col__type--fk' : ''}`}>
                          {isPK ? 'PK' : isFK ? 'FK' : shortType(col.type)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
