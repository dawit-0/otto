import { useState, useEffect, useRef } from 'react';
import type { Database, TableInfo, SavedQueryEntry, QueryHistoryEntry } from '../api';

type View = 'schema' | 'data' | 'query' | 'visualize';

interface CommandItem {
  id: string;
  group: string;
  icon: string;
  label: string;
  meta?: string;
  mono?: boolean;
  action: () => void;
}

interface Props {
  databases: Database[];
  activeDb: Database | null;
  tables: TableInfo[];
  savedQueries: SavedQueryEntry[];
  recentHistory: QueryHistoryEntry[];
  onClose: () => void;
  onSelectDb: (db: Database) => void;
  onSelectTable: (name: string) => void;
  onNavigate: (view: View) => void;
  onLoadQuery: (sql: string) => void;
  onShowConnect: () => void;
}

function buildItems(
  databases: Database[],
  activeDb: Database | null,
  tables: TableInfo[],
  savedQueries: SavedQueryEntry[],
  recentHistory: QueryHistoryEntry[],
  cb: {
    onClose: () => void;
    onSelectDb: (db: Database) => void;
    onSelectTable: (name: string) => void;
    onNavigate: (view: View) => void;
    onLoadQuery: (sql: string) => void;
    onShowConnect: () => void;
  }
): CommandItem[] {
  const items: CommandItem[] = [];

  items.push(
    { id: 'nav-schema', group: 'Navigate', icon: '◈', label: 'Schema', meta: 'Explore table relationships', action: () => { cb.onNavigate('schema'); cb.onClose(); } },
    { id: 'nav-data', group: 'Navigate', icon: '⊞', label: 'Data', meta: 'Browse table rows', action: () => { cb.onNavigate('data'); cb.onClose(); } },
    { id: 'nav-query', group: 'Navigate', icon: '▷', label: 'Query', meta: 'Write and run SQL', action: () => { cb.onNavigate('query'); cb.onClose(); } },
    { id: 'nav-visualize', group: 'Navigate', icon: '◉', label: 'Visualize', meta: 'Charts and dashboards', action: () => { cb.onNavigate('visualize'); cb.onClose(); } },
    { id: 'connect', group: 'Navigate', icon: '+', label: 'Connect Database', meta: 'Add a new database', action: () => { cb.onShowConnect(); cb.onClose(); } },
  );

  for (const db of databases) {
    if (db.id !== activeDb?.id) {
      items.push({
        id: `db-${db.id}`, group: 'Databases', icon: '■',
        label: `Switch to ${db.name}`,
        meta: db.path,
        action: () => { cb.onSelectDb(db); cb.onClose(); },
      });
    }
  }

  for (const t of tables) {
    items.push({
      id: `table-${t.name}`, group: 'Tables', icon: '▦',
      label: t.name,
      meta: `${t.row_count.toLocaleString()} rows`,
      action: () => { cb.onSelectTable(t.name); cb.onClose(); },
    });
  }

  for (const q of savedQueries) {
    items.push({
      id: `sq-${q.id}`, group: 'Saved Queries', icon: '★',
      label: q.name,
      meta: q.sql.replace(/\s+/g, ' ').trim().slice(0, 60),
      mono: true,
      action: () => { cb.onLoadQuery(q.sql); cb.onNavigate('query'); cb.onClose(); },
    });
  }

  const seen = new Set<string>();
  for (const h of recentHistory) {
    if (h.status !== 'success') continue;
    const key = h.sql.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: `hist-${h.id}`, group: 'Recent', icon: '↺',
      label: h.sql.replace(/\s+/g, ' ').trim(),
      meta: new Date(h.executed_at).toLocaleDateString(),
      mono: true,
      action: () => { cb.onLoadQuery(h.sql); cb.onNavigate('query'); cb.onClose(); },
    });
    if (seen.size >= 8) break;
  }

  return items;
}

export default function CommandPalette(props: Props) {
  const {
    databases, activeDb, tables, savedQueries, recentHistory,
    onClose, onSelectDb, onSelectTable, onNavigate, onLoadQuery, onShowConnect,
  } = props;

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const cb = { onClose, onSelectDb, onSelectTable, onNavigate, onLoadQuery, onShowConnect };
  const allItems = buildItems(databases, activeDb, tables, savedQueries, recentHistory, cb);

  const filtered = query.trim()
    ? allItems.filter(item => {
        const q = query.toLowerCase();
        return (
          item.label.toLowerCase().includes(q) ||
          item.group.toLowerCase().includes(q) ||
          (item.meta?.toLowerCase().includes(q) ?? false)
        );
      })
    : allItems;

  useEffect(() => { setActiveIndex(0); }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { filtered[activeIndex]?.action(); }
    else if (e.key === 'Escape') { onClose(); }
  };

  // Build groups while preserving global keyboard-nav index
  const groups: { name: string; items: (CommandItem & { globalIndex: number })[] }[] = [];
  let idx = 0;
  for (const item of filtered) {
    const last = groups[groups.length - 1];
    if (!last || last.name !== item.group) groups.push({ name: item.group, items: [] });
    groups[groups.length - 1].items.push({ ...item, globalIndex: idx++ });
  }

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="cmd-input-wrap">
          <svg className="cmd-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search tables, queries, commands..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <kbd className="cmd-esc-badge">ESC</kbd>
        </div>

        <div className="cmd-list" ref={listRef}>
          {groups.length === 0 && (
            <div className="cmd-empty">No results for &ldquo;{query}&rdquo;</div>
          )}
          {groups.map(group => (
            <div key={group.name}>
              <div className="cmd-group-label">{group.name}</div>
              {group.items.map(item => (
                <button
                  key={item.id}
                  className={`cmd-item${item.globalIndex === activeIndex ? ' active' : ''}`}
                  data-active={item.globalIndex === activeIndex}
                  onMouseEnter={() => setActiveIndex(item.globalIndex)}
                  onClick={item.action}
                >
                  <span className="cmd-item-icon">{item.icon}</span>
                  <span className={`cmd-item-label${item.mono ? ' cmd-mono' : ''}`}>{item.label}</span>
                  {item.meta && (
                    <span className={`cmd-item-meta${item.mono ? ' cmd-mono' : ''}`}>{item.meta}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>

        {filtered.length > 0 && (
          <div className="cmd-footer">
            <span><kbd>↑↓</kbd> navigate</span>
            <span><kbd>↵</kbd> select</span>
            <span><kbd>Esc</kbd> close</span>
          </div>
        )}
      </div>
    </div>
  );
}
