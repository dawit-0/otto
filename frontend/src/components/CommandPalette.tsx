import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api, type TableInfo, type SavedQueryEntry, type QueryHistoryEntry } from '../api';

interface Props {
  tables: TableInfo[];
  dbId: string;
  onSelectTable: (name: string) => void;
  onLoadQuery: (sql: string) => void;
  onClose: () => void;
}

type ItemType = 'table' | 'column' | 'saved' | 'history';

interface PaletteItem {
  id: string;
  type: ItemType;
  primary: string;
  secondary?: string;
  badge?: string;
  action: () => void;
}

const TYPE_LABEL: Record<ItemType, string> = {
  table: 'Tables',
  column: 'Columns',
  saved: 'Saved Queries',
  history: 'Recent Queries',
};

function scoreMatch(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 60;
  // Fuzzy: all query chars appear in order
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length ? 20 : 0;
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="palette-match">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function formatDuration(ms: number | null) {
  if (ms == null) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const TableIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="3" y1="15" x2="21" y2="15" />
    <line x1="9" y1="9" x2="9" y2="21" />
    <line x1="15" y1="9" x2="15" y2="21" />
  </svg>
);

const ColumnIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const SavedIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

const HistoryIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="12 8 12 12 14 14" />
    <path d="M3.05 11a9 9 0 1 0 .5-4" />
    <polyline points="3 2 3 7 8 7" />
  </svg>
);

const ICONS: Record<ItemType, React.ReactNode> = {
  table: <TableIcon />,
  column: <ColumnIcon />,
  saved: <SavedIcon />,
  history: <HistoryIcon />,
};

export default function CommandPalette({ tables, dbId, onSelectTable, onLoadQuery, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [savedQueries, setSavedQueries] = useState<SavedQueryEntry[]>([]);
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listSavedQueries(dbId).then(setSavedQueries).catch(() => {});
    api.getQueryHistory(dbId, 30).then(setHistory).catch(() => {});
  }, [dbId]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const allItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];

    for (const table of tables) {
      items.push({
        id: `table:${table.name}`,
        type: 'table',
        primary: table.name,
        secondary: `${table.columns.length} col${table.columns.length !== 1 ? 's' : ''} · ${table.row_count.toLocaleString()} rows`,
        action: () => { onSelectTable(table.name); onClose(); },
      });
    }

    for (const table of tables) {
      for (const col of table.columns) {
        items.push({
          id: `col:${table.name}.${col.name}`,
          type: 'column',
          primary: col.name,
          secondary: table.name,
          badge: col.type,
          action: () => { onSelectTable(table.name); onClose(); },
        });
      }
    }

    for (const sq of savedQueries) {
      items.push({
        id: `saved:${sq.id}`,
        type: 'saved',
        primary: sq.name,
        secondary: sq.description || sq.sql.slice(0, 72),
        action: () => { onLoadQuery(sq.sql); onClose(); },
      });
    }

    const seenSql = new Set<string>();
    for (const h of history) {
      const key = h.sql.trim();
      if (seenSql.has(key)) continue;
      seenSql.add(key);
      const snippet = h.sql.replace(/\s+/g, ' ').trim();
      items.push({
        id: `hist:${h.id}`,
        type: 'history',
        primary: snippet.length > 72 ? snippet.slice(0, 72) + '…' : snippet,
        secondary: h.status === 'success'
          ? `${(h.row_count ?? 0).toLocaleString()} rows · ${formatDuration(h.duration_ms)}`
          : 'Error',
        action: () => { onLoadQuery(h.sql); onClose(); },
      });
    }

    return items;
  }, [tables, savedQueries, history, onSelectTable, onLoadQuery, onClose]);

  const filteredItems = useMemo<PaletteItem[]>(() => {
    const q = query.trim();
    if (!q) {
      return [
        ...allItems.filter(i => i.type === 'table').slice(0, 10),
        ...allItems.filter(i => i.type === 'saved').slice(0, 5),
        ...allItems.filter(i => i.type === 'history').slice(0, 5),
      ];
    }
    return allItems
      .map(item => {
        const ps = scoreMatch(item.primary, q);
        const ss = item.secondary ? scoreMatch(item.secondary, q) * 0.4 : 0;
        return { item, score: Math.max(ps, ss) };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25)
      .map(({ item }) => item);
  }, [allItems, query]);

  // Attach showHeader flag in a memo so render is pure
  const displayItems = useMemo(() => {
    const isSearching = query.trim().length > 0;
    let lastType: ItemType | null = null;
    return filteredItems.map(item => {
      const showHeader = !isSearching && item.type !== lastType;
      lastType = item.type;
      return { item, showHeader };
    });
  }, [filteredItems, query]);

  useEffect(() => { setActiveIndex(0); }, [filteredItems]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-palette-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, filteredItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      filteredItems[activeIndex]?.action();
    }
  }, [filteredItems, activeIndex, onClose]);

  return (
    <div className="palette-overlay" onClick={onClose} role="dialog" aria-label="Command Palette" aria-modal="true">
      <div className="palette" onClick={e => e.stopPropagation()}>
        <div className="palette-search-row">
          <svg className="palette-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search tables, columns, queries…"
            value={query}
            onChange={e => { setQuery(e.target.value); }}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button className="palette-clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }} tabIndex={-1} aria-label="Clear search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="palette-results" ref={listRef}>
          {displayItems.length === 0 ? (
            <div className="palette-empty">No results for "{query}"</div>
          ) : (
            displayItems.map(({ item, showHeader }, i) => (
              <div key={item.id}>
                {showHeader && (
                  <div className="palette-group-label">{TYPE_LABEL[item.type]}</div>
                )}
                <button
                  data-palette-index={i}
                  className={`palette-item${i === activeIndex ? ' palette-item-active' : ''}`}
                  onClick={item.action}
                  onMouseMove={() => setActiveIndex(i)}
                >
                  <span className={`palette-item-icon palette-icon-${item.type}`}>
                    {ICONS[item.type]}
                  </span>
                  <span className="palette-item-body">
                    <span className="palette-item-primary">
                      <HighlightedText text={item.primary} query={query} />
                    </span>
                    {item.secondary && (
                      <span className="palette-item-secondary">
                        <HighlightedText text={item.secondary} query={query} />
                      </span>
                    )}
                  </span>
                  {item.badge && (
                    <span className="palette-item-badge">{item.badge}</span>
                  )}
                </button>
              </div>
            ))
          )}
        </div>

        <div className="palette-footer">
          <span className="palette-footer-hint"><kbd>↑↓</kbd> Navigate</span>
          <span className="palette-footer-hint"><kbd>↵</kbd> Select</span>
          <span className="palette-footer-hint"><kbd>Esc</kbd> Close</span>
          <span className="palette-footer-sep" />
          <span className="palette-footer-count">
            {filteredItems.length} result{filteredItems.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
