import { useState, useEffect, useRef, useCallback } from 'react';
import { api, type Database, type TableInfo, type QueryHistoryEntry, type SavedQueryEntry } from '../api';

type View = 'overview' | 'schema' | 'data' | 'query' | 'visualize' | 'ask';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  databases: Database[];
  activeDb: Database | null;
  tables: TableInfo[];
  onSelectTable: (name: string) => void;
  onSelectDb: (db: Database) => void;
  onNavigate: (view: View) => void;
  onLoadQuery: (sql: string) => void;
}

interface PaletteItem {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  action: () => void;
}

const NAV_ITEMS: Array<{ view: View; label: string; description: string }> = [
  { view: 'overview', label: 'Overview', description: 'Database stats and table summary' },
  { view: 'schema', label: 'Schema Graph', description: 'Interactive ERD diagram' },
  { view: 'data', label: 'Data Browser', description: 'Browse and filter table rows' },
  { view: 'query', label: 'Query Editor', description: 'Write and execute SQL' },
  { view: 'visualize', label: 'Visualizations', description: 'Charts and dashboard panels' },
  { view: 'ask', label: 'Ask Otto', description: 'Generate SQL with natural language' },
];

function matchesQuery(text: string, q: string) {
  return text.toLowerCase().includes(q);
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="palette-highlight">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function NavIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18" />
    </svg>
  );
}

function DatabaseIcon({ type }: { type: 'sqlite' | 'postgres' }) {
  return (
    <span className={`db-type-badge ${type === 'postgres' ? 'pg' : 'sl'}`} style={{ fontSize: 9, padding: '1px 4px' }}>
      {type === 'postgres' ? 'PG' : 'SL'}
    </span>
  );
}

function BookmarkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="12 8 12 12 14 14" />
      <path d="M3.05 11a9 9 0 1 0 .5-4.5" />
      <polyline points="3 3 3 7 7 7" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function EnterIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 10 4 15 9 20" />
      <path d="M20 4v7a4 4 0 0 1-4 4H4" />
    </svg>
  );
}

export default function CommandPalette({
  isOpen, onClose, databases, activeDb, tables,
  onSelectTable, onSelectDb, onNavigate, onLoadQuery,
}: Props) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [savedQueries, setSavedQueries] = useState<SavedQueryEntry[]>([]);
  const [recentHistory, setRecentHistory] = useState<QueryHistoryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
      if (activeDb) {
        api.listSavedQueries(activeDb.id).then(setSavedQueries).catch(() => {});
        api.getQueryHistory(activeDb.id, 10).then(setRecentHistory).catch(() => {});
      }
    }
  }, [isOpen, activeDb]);

  const buildItems = useCallback((): PaletteItem[] => {
    const q = query.trim().toLowerCase();
    const result: PaletteItem[] = [];

    // Navigation views
    for (const nav of NAV_ITEMS) {
      if (!q || matchesQuery(nav.label, q) || matchesQuery(nav.description, q)) {
        result.push({
          id: `nav-${nav.view}`,
          group: 'Navigate',
          title: nav.label,
          subtitle: nav.description,
          icon: <NavIcon />,
          action: () => { onNavigate(nav.view); onClose(); },
        });
      }
    }

    // Switch database (always show when multiple dbs, or when query matches)
    for (const db of databases) {
      if (!q || matchesQuery(db.name, q) || matchesQuery(db.db_type, q)) {
        result.push({
          id: `db-${db.id}`,
          group: 'Databases',
          title: db.name,
          subtitle: db.db_type === 'postgres' ? 'PostgreSQL' : 'SQLite',
          icon: <DatabaseIcon type={db.db_type} />,
          action: () => { onSelectDb(db); onClose(); },
        });
      }
    }

    // Tables
    for (const table of tables) {
      if (!q || matchesQuery(table.name, q)) {
        result.push({
          id: `table-${table.name}`,
          group: 'Tables',
          title: table.name,
          subtitle: `${table.row_count.toLocaleString()} rows · ${table.columns.length} columns`,
          icon: <TableIcon />,
          action: () => { onSelectTable(table.name); onClose(); },
        });
      }
    }

    // Saved queries
    for (const sq of savedQueries) {
      if (!q || matchesQuery(sq.name, q) || matchesQuery(sq.sql, q)) {
        result.push({
          id: `saved-${sq.id}`,
          group: 'Saved Queries',
          title: sq.name,
          subtitle: sq.sql.replace(/\s+/g, ' ').slice(0, 72),
          icon: <BookmarkIcon />,
          action: () => { onLoadQuery(sq.sql); onClose(); },
        });
      }
    }

    // Recent history (deduplicated by SQL prefix)
    const seenSql = new Set<string>();
    for (const entry of recentHistory) {
      const key = entry.sql.slice(0, 60);
      if (seenSql.has(key)) continue;
      seenSql.add(key);
      const shortSql = entry.sql.replace(/\s+/g, ' ').slice(0, 72);
      if (!q || matchesQuery(shortSql, q)) {
        result.push({
          id: `hist-${entry.id}`,
          group: 'Recent Queries',
          title: shortSql,
          subtitle: entry.status === 'success'
            ? `${(entry.row_count ?? 0).toLocaleString()} rows returned`
            : 'Error',
          icon: <HistoryIcon />,
          action: () => { onLoadQuery(entry.sql); onClose(); },
        });
      }
    }

    return result;
  }, [query, databases, tables, savedQueries, recentHistory, onNavigate, onSelectTable, onSelectDb, onLoadQuery, onClose]);

  const items = buildItems();

  useEffect(() => { setSelectedIndex(0); }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-palette-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[selectedIndex]?.action();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  // Build groups for rendering
  type GroupedItem = PaletteItem & { globalIndex: number };
  const groups: Array<{ name: string; items: GroupedItem[] }> = [];
  items.forEach((item, idx) => {
    const last = groups[groups.length - 1];
    const gi: GroupedItem = { ...item, globalIndex: idx };
    if (!last || last.name !== item.group) {
      groups.push({ name: item.group, items: [gi] });
    } else {
      last.items.push(gi);
    }
  });

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div className="palette-container" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input-row">
          <span className="palette-search-icon"><SearchIcon /></span>
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tables, navigate, load queries..."
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="palette-esc-hint" onClick={onClose}>esc</kbd>
        </div>

        <div className="palette-results" ref={listRef}>
          {items.length === 0 && query && (
            <div className="palette-empty">No results for &ldquo;{query}&rdquo;</div>
          )}
          {items.length === 0 && !query && (
            <div className="palette-empty">No database connected</div>
          )}
          {groups.map((group) => (
            <div key={group.name} className="palette-group">
              <div className="palette-group-label">{group.name}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  data-palette-index={item.globalIndex}
                  className={`palette-item${item.globalIndex === selectedIndex ? ' palette-item-selected' : ''}`}
                  onMouseDown={item.action}
                  onMouseEnter={() => setSelectedIndex(item.globalIndex)}
                >
                  <span className="palette-item-icon">{item.icon}</span>
                  <span className="palette-item-body">
                    <span className="palette-item-title">
                      <HighlightedText text={item.title} query={query} />
                    </span>
                    {item.subtitle && (
                      <span className="palette-item-subtitle">{item.subtitle}</span>
                    )}
                  </span>
                  {item.globalIndex === selectedIndex && (
                    <span className="palette-item-enter"><EnterIcon /></span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="palette-footer">
          <span className="palette-footer-hint"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span className="palette-footer-hint"><kbd>↵</kbd> select</span>
          <span className="palette-footer-hint"><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
