import { useState, useEffect, useRef, useCallback } from 'react';
import { api, type Database, type TableInfo, type SavedQueryEntry, type QueryHistoryEntry } from '../api';

type View = 'schema' | 'data' | 'query' | 'visualize';

interface Props {
  tables: TableInfo[];
  databases: Database[];
  activeDb: Database | null;
  onSelectTable: (name: string) => void;
  onSelectDb: (db: Database) => void;
  onNavigate: (view: View) => void;
  onOpenConnect: () => void;
  onLoadSql: (sql: string) => void;
  onClose: () => void;
}

type CommandItem =
  | { kind: 'navigate'; view: View; label: string; icon: string }
  | { kind: 'connect' }
  | { kind: 'switch_db'; db: Database }
  | { kind: 'table'; table: TableInfo }
  | { kind: 'saved'; entry: SavedQueryEntry }
  | { kind: 'history'; entry: QueryHistoryEntry };

const NAV_ITEMS = [
  { view: 'schema' as View, label: 'Schema', desc: 'View ER diagram', icon: '◈' },
  { view: 'query' as View, label: 'Query', desc: 'Run SQL', icon: '▷' },
  { view: 'visualize' as View, label: 'Visualize', desc: 'Charts & dashboards', icon: '▦' },
  { view: 'data' as View, label: 'Data', desc: 'Browse table rows', icon: '⊞' },
];

function matches(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function getItemKey(item: CommandItem, idx: number): string {
  switch (item.kind) {
    case 'navigate': return `nav-${item.view}`;
    case 'connect': return 'connect';
    case 'switch_db': return `db-${item.db.id}`;
    case 'table': return `table-${item.table.name}`;
    case 'saved': return `saved-${item.entry.id}`;
    case 'history': return `hist-${item.entry.id}-${idx}`;
  }
}

export default function CommandPalette({
  tables, databases, activeDb,
  onSelectTable, onSelectDb, onNavigate, onOpenConnect, onLoadSql, onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [savedQueries, setSavedQueries] = useState<SavedQueryEntry[]>([]);
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const loadData = async () => {
      try {
        const [sq, hist] = await Promise.all([
          api.listSavedQueries(activeDb?.id),
          api.getQueryHistory(activeDb?.id, 20),
        ]);
        setSavedQueries(sq);
        setHistory(hist.filter(h => h.status === 'success'));
      } catch {
        // non-critical
      }
    };
    if (activeDb) loadData();
  }, [activeDb]);

  const q = query.trim();

  // Build flat items array for keyboard nav
  const items: CommandItem[] = [];

  // Navigation
  for (const nav of NAV_ITEMS) {
    if (!q || matches(nav.label, q) || matches(nav.desc, q)) {
      items.push({ kind: 'navigate', view: nav.view, label: nav.label, icon: nav.icon });
    }
  }

  // Connect DB
  if (!q || matches('connect database', q)) {
    items.push({ kind: 'connect' });
  }

  // Switch database
  for (const db of databases) {
    if (db.id !== activeDb?.id && (!q || matches(db.name, q))) {
      items.push({ kind: 'switch_db', db });
    }
  }

  // Tables
  for (const table of tables) {
    if (!q || matches(table.name, q)) {
      items.push({ kind: 'table', table });
    }
  }

  // Saved queries
  for (const entry of savedQueries) {
    if (!q || matches(entry.name, q) || matches(entry.sql, q) || (entry.description && matches(entry.description, q))) {
      items.push({ kind: 'saved', entry });
    }
  }

  // History (last 5 unique SQL)
  const seenSql = new Set<string>();
  let histCount = 0;
  for (const entry of history) {
    if (histCount >= 5) break;
    const shortSql = entry.sql.trim();
    if (seenSql.has(shortSql)) continue;
    if (!q || matches(shortSql, q)) {
      seenSql.add(shortSql);
      items.push({ kind: 'history', entry });
      histCount++;
    }
  }

  const safeIdx = items.length === 0 ? 0 : ((selectedIdx % items.length) + items.length) % items.length;

  const execute = useCallback((item: CommandItem) => {
    switch (item.kind) {
      case 'navigate':
        onNavigate(item.view);
        break;
      case 'connect':
        onOpenConnect();
        break;
      case 'switch_db':
        onSelectDb(item.db);
        break;
      case 'table':
        onSelectTable(item.table.name);
        break;
      case 'saved':
        onLoadSql(item.entry.sql);
        onNavigate('query');
        break;
      case 'history':
        onLoadSql(item.entry.sql);
        onNavigate('query');
        break;
    }
    onClose();
  }, [onNavigate, onOpenConnect, onSelectDb, onSelectTable, onLoadSql, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => i + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[safeIdx];
      if (item) execute(item);
    }
  }, [items, safeIdx, execute, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-selected="true"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [safeIdx]);

  // Group items for rendering with section headers
  const navItems = items.filter(i => i.kind === 'navigate' || i.kind === 'connect' || i.kind === 'switch_db');
  const tableItems = items.filter(i => i.kind === 'table') as Extract<CommandItem, { kind: 'table' }>[];
  const savedItems = items.filter(i => i.kind === 'saved') as Extract<CommandItem, { kind: 'saved' }>[];
  const histItems = items.filter(i => i.kind === 'history') as Extract<CommandItem, { kind: 'history' }>[];

  function renderItem(item: CommandItem, idx: number) {
    const isSelected = idx === safeIdx;
    return (
      <button
        key={getItemKey(item, idx)}
        data-selected={isSelected}
        className={`cp-item${isSelected ? ' selected' : ''}`}
        onMouseEnter={() => setSelectedIdx(idx)}
        onClick={() => execute(item)}
      >
        {renderItemContent(item)}
      </button>
    );
  }

  function renderItemContent(item: CommandItem) {
    switch (item.kind) {
      case 'navigate': {
        const nav = NAV_ITEMS.find(n => n.view === item.view)!;
        return (
          <>
            <span className="cp-item-icon">{nav.icon}</span>
            <span className="cp-item-text">
              <span className="cp-item-primary">{nav.label}</span>
              <span className="cp-item-secondary">{nav.desc}</span>
            </span>
            <span className="cp-item-badge cp-badge-nav">Navigate</span>
          </>
        );
      }
      case 'connect':
        return (
          <>
            <span className="cp-item-icon">+</span>
            <span className="cp-item-text">
              <span className="cp-item-primary">Connect Database</span>
              <span className="cp-item-secondary">Open a local SQLite file</span>
            </span>
          </>
        );
      case 'switch_db':
        return (
          <>
            <span className="cp-item-icon">&#9632;</span>
            <span className="cp-item-text">
              <span className="cp-item-primary">{item.db.name}</span>
              <span className="cp-item-secondary cp-mono">{item.db.path}</span>
            </span>
            <span className="cp-item-badge cp-badge-db">Switch DB</span>
          </>
        );
      case 'table':
        return (
          <>
            <span className="cp-item-icon cp-table-icon">T</span>
            <span className="cp-item-text">
              <span className="cp-item-primary cp-mono">{item.table.name}</span>
              <span className="cp-item-secondary">{item.table.row_count.toLocaleString()} rows · {item.table.columns.length} columns</span>
            </span>
            <span className="cp-item-badge cp-badge-table">Table</span>
          </>
        );
      case 'saved':
        return (
          <>
            <span className="cp-item-icon">★</span>
            <span className="cp-item-text">
              <span className="cp-item-primary">{item.entry.name}</span>
              <span className="cp-item-secondary cp-mono">{item.entry.sql.replace(/\s+/g, ' ').trim()}</span>
            </span>
            <span className="cp-item-badge cp-badge-saved">Saved</span>
          </>
        );
      case 'history':
        return (
          <>
            <span className="cp-item-icon cp-hist-icon">↺</span>
            <span className="cp-item-text">
              <span className="cp-item-primary cp-mono">{item.entry.sql.replace(/\s+/g, ' ').trim()}</span>
              <span className="cp-item-secondary">{item.entry.row_count?.toLocaleString() ?? '—'} rows · {item.entry.duration_ms}ms</span>
            </span>
            <span className="cp-item-badge cp-badge-hist">Recent</span>
          </>
        );
    }
  }

  // Build flat array in section order for index tracking
  const orderedItems = [...navItems, ...tableItems, ...savedItems, ...histItems];
  let runningIdx = 0;

  function renderSection(label: string, sectionItems: CommandItem[]) {
    if (sectionItems.length === 0) return null;
    const startIdx = runningIdx;
    runningIdx += sectionItems.length;
    return (
      <div key={label} className="cp-section">
        <div className="cp-section-label">{label}</div>
        {sectionItems.map((item, i) => renderItem(item, startIdx + i))}
      </div>
    );
  }

  return (
    <div className="cp-overlay" onClick={onClose}>
      <div className="cp-container" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="cp-search-bar">
          <span className="cp-search-icon">⌕</span>
          <input
            ref={inputRef}
            className="cp-input"
            type="text"
            placeholder="Search tables, queries, or navigate…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <button className="cp-clear-btn" onClick={() => setQuery('')}>✕</button>
          )}
        </div>

        <div ref={listRef} className="cp-results">
          {orderedItems.length === 0 ? (
            <div className="cp-empty">No results for "{query}"</div>
          ) : (
            <>
              {renderSection('Navigation', navItems)}
              {renderSection('Tables', tableItems)}
              {renderSection('Saved Queries', savedItems)}
              {renderSection('Recent Queries', histItems)}
            </>
          )}
        </div>

        <div className="cp-footer">
          <span className="cp-hint">↑↓ navigate</span>
          <span className="cp-hint-sep">·</span>
          <span className="cp-hint">↵ select</span>
          <span className="cp-hint-sep">·</span>
          <span className="cp-hint">Esc close</span>
          {activeDb && (
            <>
              <span className="cp-hint-sep cp-hint-spacer">·</span>
              <span className="cp-hint cp-hint-db">&#9632; {activeDb.name}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
