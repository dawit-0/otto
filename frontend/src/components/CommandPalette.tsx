import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { api, type TableInfo, type SavedQueryEntry, type SavedVisualization, type QueryHistoryEntry } from '../api';

type ResultKind = 'table' | 'saved-query' | 'visualization' | 'history';

interface TableResult {
  kind: 'table'; id: string; label: string; sublabel: string; table: TableInfo;
}
interface SavedQueryResult {
  kind: 'saved-query'; id: string; label: string; sublabel: string; savedQuery: SavedQueryEntry;
}
interface VisualizationResult {
  kind: 'visualization'; id: string; label: string; sublabel: string; visualization: SavedVisualization;
}
interface HistoryResult {
  kind: 'history'; id: string; label: string; sublabel: string; historyEntry: QueryHistoryEntry;
}
type PaletteResult = TableResult | SavedQueryResult | VisualizationResult | HistoryResult;

const GROUPS: { kind: ResultKind; label: string }[] = [
  { kind: 'table', label: 'Tables' },
  { kind: 'saved-query', label: 'Saved Queries' },
  { kind: 'visualization', label: 'Visualizations' },
  { kind: 'history', label: 'Recent History' },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  dbId: string | null;
  tables: TableInfo[];
  onSelectTable: (name: string) => void;
  onLoadQuery: (sql: string) => void;
  onGoVisualize: () => void;
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function KindIcon({ kind }: { kind: ResultKind }) {
  switch (kind) {
    case 'table':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
          <line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1.2" />
          <line x1="5" y1="5" x2="5" y2="13" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case 'saved-query':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <line x1="3.5" y1="4.5" x2="10.5" y2="4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="3.5" y1="7" x2="10.5" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="3.5" y1="9.5" x2="7.5" y2="9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case 'visualization':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
          <line x1="3" y1="11" x2="3" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <line x1="6" y1="11" x2="6" y2="5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <line x1="9" y1="11" x2="9" y2="7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <line x1="12" y1="11" x2="12" y2="4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case 'history':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
          <polyline points="7,4 7,7 9.5,7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

function matches(text: string, q: string): boolean {
  if (!q) return true;
  return text.toLowerCase().includes(q.toLowerCase());
}

export default function CommandPalette({
  isOpen,
  onClose,
  dbId,
  tables,
  onSelectTable,
  onLoadQuery,
  onGoVisualize,
}: Props) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [savedQueries, setSavedQueries] = useState<SavedQueryEntry[]>([]);
  const [visualizations, setVisualizations] = useState<SavedVisualization[]>([]);
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !dbId) return;
    api.listSavedQueries(dbId).then(setSavedQueries).catch(() => setSavedQueries([]));
    api.listVisualizations(dbId).then(setVisualizations).catch(() => setVisualizations([]));
    api.getQueryHistory(dbId, 15).then(setHistory).catch(() => setHistory([]));
  }, [isOpen, dbId]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const results = useMemo((): PaletteResult[] => {
    const q = query.trim();
    const out: PaletteResult[] = [];

    tables
      .filter(t => matches(t.name, q))
      .slice(0, 7)
      .forEach(t =>
        out.push({
          kind: 'table',
          id: `table-${t.name}`,
          label: t.name,
          sublabel: `${t.columns.length} col${t.columns.length !== 1 ? 's' : ''} · ${t.row_count.toLocaleString()} rows`,
          table: t,
        })
      );

    savedQueries
      .filter(sq => matches(sq.name, q) || matches(sq.sql, q) || (sq.description && matches(sq.description, q)))
      .slice(0, 4)
      .forEach(sq =>
        out.push({
          kind: 'saved-query',
          id: `saved-${sq.id}`,
          label: sq.name,
          sublabel: sq.description?.trim() || sq.sql.replace(/\s+/g, ' ').slice(0, 60),
          savedQuery: sq,
        })
      );

    visualizations
      .filter(v => matches(v.title, q) || matches(v.chart_type, q))
      .slice(0, 4)
      .forEach(v =>
        out.push({
          kind: 'visualization',
          id: `viz-${v.id}`,
          label: v.title,
          sublabel: `${v.chart_type} chart`,
          visualization: v,
        })
      );

    history
      .filter(h => matches(h.sql, q) || matches(h.db_name, q))
      .filter(h => h.status === 'success')
      .slice(0, 5)
      .forEach(h =>
        out.push({
          kind: 'history',
          id: `history-${h.id}`,
          label: h.sql.replace(/\s+/g, ' ').slice(0, 80) + (h.sql.length > 80 ? '…' : ''),
          sublabel: `${new Date(h.executed_at).toLocaleDateString()} · ${(h.row_count ?? 0).toLocaleString()} rows`,
          historyEntry: h,
        })
      );

    return out;
  }, [query, tables, savedQueries, visualizations, history]);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIdx]);

  const execute = useCallback(
    (result: PaletteResult) => {
      onClose();
      switch (result.kind) {
        case 'table':
          onSelectTable(result.table.name);
          break;
        case 'saved-query':
          onLoadQuery(result.savedQuery.sql);
          break;
        case 'visualization':
          onGoVisualize();
          break;
        case 'history':
          onLoadQuery(result.historyEntry.sql);
          break;
      }
    },
    [onClose, onSelectTable, onLoadQuery, onGoVisualize]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && results.length > 0) {
        e.preventDefault();
        execute(results[Math.min(activeIdx, results.length - 1)]);
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [results, activeIdx, execute, onClose]
  );

  if (!isOpen) return null;

  const indexMap = new Map<string, number>();
  results.forEach((r, i) => indexMap.set(r.id, i));

  const grouped = GROUPS.map(g => ({
    ...g,
    items: results.filter(r => r.kind === g.kind),
  })).filter(g => g.items.length > 0);

  const q = query.trim();

  return (
    <div className="modal-overlay cmd-palette-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="cmd-palette-search">
          <span className="cmd-palette-search-icon">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            className="cmd-palette-input"
            placeholder="Search tables, queries, visualizations…"
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button className="cmd-palette-clear" onClick={() => { setQuery(''); setActiveIdx(0); inputRef.current?.focus(); }} aria-label="Clear search">
              &#x2715;
            </button>
          )}
          <kbd className="cmd-palette-esc" onClick={onClose}>esc</kbd>
        </div>

        <div className="cmd-palette-results">
          {results.length === 0 ? (
            <div className="cmd-palette-empty">
              {q
                ? <>No results for <strong>"{q}"</strong></>
                : 'Start typing to search tables, queries, and more…'
              }
            </div>
          ) : (
            grouped.map(({ kind, label, items }) => (
              <div key={kind} className="cmd-palette-group">
                <div className="cmd-palette-group-label">{label}</div>
                {items.map(result => {
                  const idx = indexMap.get(result.id)!;
                  const isActive = idx === activeIdx;
                  return (
                    <div
                      key={result.id}
                      ref={isActive ? activeItemRef : undefined}
                      className={`cmd-palette-item${isActive ? ' active' : ''}`}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => execute(result)}
                    >
                      <span className={`cmd-palette-item-icon cmd-palette-icon-${result.kind}`}>
                        <KindIcon kind={result.kind} />
                      </span>
                      <div className="cmd-palette-item-text">
                        <span className="cmd-palette-item-label">{result.label}</span>
                        {result.sublabel && (
                          <span className="cmd-palette-item-sublabel">{result.sublabel}</span>
                        )}
                      </div>
                      {isActive && <kbd className="cmd-palette-enter">&#x23CE;</kbd>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="cmd-palette-footer">
          <span className="cmd-palette-hint"><kbd>↑↓</kbd> navigate</span>
          <span className="cmd-palette-hint"><kbd>↵</kbd> open</span>
          <span className="cmd-palette-hint"><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
