import { useState, useEffect, useRef } from 'react';
import { api, type TableInfo, type Database, type SavedQueryEntry } from '../api';

type View = 'overview' | 'schema' | 'data' | 'query' | 'visualize' | 'ask';

interface PaletteItem {
  id: string;
  kind: 'table' | 'saved-query' | 'view';
  label: string;
  hint: string;
  action: () => void;
}

interface Props {
  tables: TableInfo[];
  activeDb: Database | null;
  onNavigateTable: (tableName: string) => void;
  onNavigateView: (view: View) => void;
  onLoadQuery: (sql: string) => void;
  onClose: () => void;
}

const NAV_VIEWS: { view: View; label: string; hint: string }[] = [
  { view: 'overview',   label: 'Overview',        hint: 'Database summary & statistics' },
  { view: 'schema',     label: 'Schema',           hint: 'ER diagram & table relationships' },
  { view: 'data',       label: 'Data Browser',     hint: 'Browse tables & filter rows' },
  { view: 'query',      label: 'SQL Editor',       hint: 'Write & execute SQL queries' },
  { view: 'visualize',  label: 'Visualizations',   hint: 'Charts & dashboard panels' },
  { view: 'ask',        label: 'Ask Otto',         hint: 'AI-powered query assistant' },
];

function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="cmd-highlight">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function TableIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

function QueryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function ViewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export default function CommandPalette({ tables, activeDb, onNavigateTable, onNavigateView, onLoadQuery, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [savedQueries, setSavedQueries] = useState<SavedQueryEntry[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (activeDb) {
      api.listSavedQueries(activeDb.id).then(setSavedQueries).catch(() => {});
    }
  }, [activeDb]);

  const q = query.toLowerCase().trim();
  const items: PaletteItem[] = [];

  for (const table of tables) {
    if (!q || table.name.toLowerCase().includes(q)) {
      items.push({
        id: `table:${table.name}`,
        kind: 'table',
        label: table.name,
        hint: `${table.row_count.toLocaleString()} rows · ${table.columns.length} columns`,
        action: () => onNavigateTable(table.name),
      });
    }
  }

  for (const sq of savedQueries) {
    const matchesName = sq.name.toLowerCase().includes(q);
    const matchesDesc = sq.description?.toLowerCase().includes(q) ?? false;
    if (!q || matchesName || matchesDesc) {
      items.push({
        id: `sq:${sq.id}`,
        kind: 'saved-query',
        label: sq.name,
        hint: sq.description || sq.sql.replace(/\s+/g, ' ').slice(0, 72),
        action: () => onLoadQuery(sq.sql),
      });
    }
  }

  for (const v of NAV_VIEWS) {
    if (!q || v.label.toLowerCase().includes(q) || v.hint.toLowerCase().includes(q)) {
      items.push({
        id: `view:${v.view}`,
        kind: 'view',
        label: v.label,
        hint: v.hint,
        action: () => onNavigateView(v.view),
      });
    }
  }

  useEffect(() => { setSelectedIdx(0); }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelectorAll<HTMLElement>('.cmd-item')[selectedIdx];
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, items.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && items[selectedIdx]) { items[selectedIdx].action(); onClose(); }
  };

  const kindMeta = (kind: PaletteItem['kind']) => {
    if (kind === 'table')       return { icon: <TableIcon />, badge: 'Table' };
    if (kind === 'saved-query') return { icon: <QueryIcon />, badge: 'Query' };
    return                             { icon: <ViewIcon />,  badge: 'View'  };
  };

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()}>
        {/* Search input */}
        <div className="cmd-input-row">
          <svg className="cmd-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className="cmd-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tables, queries, views…"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button className="cmd-clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }} tabIndex={-1} aria-label="Clear search">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Results */}
        <div className="cmd-results" ref={listRef}>
          {items.length === 0 ? (
            <div className="cmd-empty">No results for "{query}"</div>
          ) : (
            items.map((item, idx) => {
              const { icon, badge } = kindMeta(item.kind);
              return (
                <button
                  key={item.id}
                  className={`cmd-item${idx === selectedIdx ? ' cmd-item-selected' : ''}`}
                  onClick={() => { item.action(); onClose(); }}
                  onMouseEnter={() => setSelectedIdx(idx)}
                >
                  <span className={`cmd-item-icon cmd-item-icon-${item.kind}`}>{icon}</span>
                  <span className="cmd-item-body">
                    <span className="cmd-item-label">{highlight(item.label, q)}</span>
                    <span className="cmd-item-hint">{item.hint}</span>
                  </span>
                  <span className={`cmd-item-badge cmd-item-badge-${item.kind}`}>{badge}</span>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="cmd-footer">
          <span className="cmd-footer-hint"><kbd>↑↓</kbd> Navigate</span>
          <span className="cmd-footer-hint"><kbd>↵</kbd> Open</span>
          <span className="cmd-footer-hint"><kbd>Esc</kbd> Dismiss</span>
          {activeDb && <span className="cmd-footer-db">{activeDb.name}</span>}
        </div>
      </div>
    </div>
  );
}
