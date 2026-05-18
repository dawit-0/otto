import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { api, type TableInfo, type SavedQueryEntry, type QueryHistoryEntry } from '../api';

type ResultKind = 'table' | 'column' | 'saved-query' | 'history';

interface SearchResult {
  kind: ResultKind;
  id: string;
  label: string;
  sublabel: string;
  icon: string;
  action: 'navigate-table' | 'load-query';
  tableName?: string;
  sql?: string;
}

interface Props {
  dbId: string;
  tables: TableInfo[];
  onNavigateTable: (tableName: string) => void;
  onLoadQuery: (sql: string) => void;
  onClose: () => void;
}

const KIND_LABELS: Record<ResultKind, string> = {
  'table': 'TABLE',
  'column': 'COLUMN',
  'saved-query': 'SAVED',
  'history': 'HISTORY',
};

const KIND_COLORS: Record<ResultKind, string> = {
  'table': 'var(--info)',
  'column': 'var(--accent-hover)',
  'saved-query': 'var(--warning)',
  'history': 'var(--text-muted)',
};

function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="cmd-highlight">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function CommandPalette({ dbId, tables, onNavigateTable, onLoadQuery, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [savedQueries, setSavedQueries] = useState<SavedQueryEntry[]>([]);
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      api.listSavedQueries(dbId),
      api.getQueryHistory(dbId, 30),
    ]).then(([sq, hist]) => {
      setSavedQueries(sq);
      setHistory(hist);
    }).catch(() => {});
    inputRef.current?.focus();
  }, [dbId]);

  const results = useMemo((): SearchResult[] => {
    const q = query.trim().toLowerCase();
    const out: SearchResult[] = [];

    if (!q) {
      tables.slice(0, 8).forEach(t => {
        out.push({
          kind: 'table',
          id: `t-${t.name}`,
          label: t.name,
          sublabel: `${t.row_count.toLocaleString()} rows · ${t.columns.length} columns`,
          icon: '⊡',
          action: 'navigate-table',
          tableName: t.name,
        });
      });
      savedQueries.slice(0, 3).forEach(sq => {
        out.push({
          kind: 'saved-query',
          id: `sq-${sq.id}`,
          label: sq.name,
          sublabel: sq.description || sq.sql.replace(/\s+/g, ' ').trim().slice(0, 80),
          icon: '★',
          action: 'load-query',
          sql: sq.sql,
        });
      });
      return out;
    }

    // Table name matches
    tables
      .filter(t => t.name.toLowerCase().includes(q))
      .slice(0, 5)
      .forEach(t => {
        out.push({
          kind: 'table',
          id: `t-${t.name}`,
          label: t.name,
          sublabel: `${t.row_count.toLocaleString()} rows · ${t.columns.length} columns`,
          icon: '⊡',
          action: 'navigate-table',
          tableName: t.name,
        });
      });

    // Column name matches
    const seen = new Set<string>();
    for (const t of tables) {
      for (const col of t.columns) {
        if (col.name.toLowerCase().includes(q)) {
          const key = `${t.name}.${col.name}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({
              kind: 'column',
              id: `c-${key}`,
              label: col.name,
              sublabel: `in ${t.name} · ${col.type || 'ANY'}${col.pk ? ' · PK' : ''}`,
              icon: '⊟',
              action: 'navigate-table',
              tableName: t.name,
            });
          }
        }
      }
      if (out.length >= 14) break;
    }

    // Saved query matches
    savedQueries
      .filter(sq => sq.name.toLowerCase().includes(q) || sq.sql.toLowerCase().includes(q))
      .slice(0, 4)
      .forEach(sq => {
        out.push({
          kind: 'saved-query',
          id: `sq-${sq.id}`,
          label: sq.name,
          sublabel: sq.description || sq.sql.replace(/\s+/g, ' ').trim().slice(0, 80),
          icon: '★',
          action: 'load-query',
          sql: sq.sql,
        });
      });

    // History matches (successful queries only)
    history
      .filter(h => h.status === 'success' && h.sql.toLowerCase().includes(q))
      .slice(0, 3)
      .forEach(h => {
        const shortSql = h.sql.replace(/\s+/g, ' ').trim();
        out.push({
          kind: 'history',
          id: `h-${h.id}`,
          label: shortSql.length > 70 ? shortSql.slice(0, 70) + '…' : shortSql,
          sublabel: `${(h.row_count ?? 0).toLocaleString()} rows · ${new Date(h.executed_at).toLocaleDateString()}`,
          icon: '◷',
          action: 'load-query',
          sql: h.sql,
        });
      });

    return out;
  }, [query, tables, savedQueries, history]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleSelect = useCallback((result: SearchResult) => {
    if (result.action === 'navigate-table' && result.tableName) {
      onNavigateTable(result.tableName);
    } else if (result.action === 'load-query' && result.sql) {
      onLoadQuery(result.sql);
    }
    onClose();
  }, [onNavigateTable, onLoadQuery, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) handleSelect(results[selectedIndex]);
    }
  };

  const trimmedQuery = query.trim();

  return (
    <div className="cmd-overlay" onMouseDown={onClose}>
      <div className="cmd-panel" onMouseDown={e => e.stopPropagation()}>
        <div className="cmd-input-row">
          <span className="cmd-search-icon" aria-hidden>⌕</span>
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search tables, columns, queries…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button className="cmd-clear-btn" onClick={() => { setQuery(''); inputRef.current?.focus(); }} aria-label="Clear">
              ✕
            </button>
          )}
        </div>

        <div className="cmd-results" ref={listRef}>
          {results.length > 0 ? (
            results.map((result, i) => (
              <button
                key={result.id}
                data-idx={i}
                className={`cmd-result-item${i === selectedIndex ? ' selected' : ''}`}
                onClick={() => handleSelect(result)}
                onMouseMove={() => setSelectedIndex(i)}
              >
                <span className="cmd-result-icon" style={{ color: KIND_COLORS[result.kind] }}>
                  {result.icon}
                </span>
                <span className="cmd-result-body">
                  <span className="cmd-result-label">
                    <Highlighted text={result.label} query={trimmedQuery} />
                  </span>
                  <span className="cmd-result-sublabel">{result.sublabel}</span>
                </span>
                <span className="cmd-result-kind" style={{ color: KIND_COLORS[result.kind] }}>
                  {KIND_LABELS[result.kind]}
                </span>
              </button>
            ))
          ) : trimmedQuery ? (
            <div className="cmd-empty">
              No results for "<strong>{query}</strong>"
            </div>
          ) : null}
        </div>

        <div className="cmd-footer">
          {!trimmedQuery && (
            <span className="cmd-footer-tip">Start typing to search…</span>
          )}
          <span className="cmd-footer-hints">
            <span className="cmd-footer-hint"><kbd>↑↓</kbd> Navigate</span>
            <span className="cmd-footer-hint"><kbd>↵</kbd> Open</span>
            <span className="cmd-footer-hint"><kbd>Esc</kbd> Close</span>
          </span>
        </div>
      </div>
    </div>
  );
}
