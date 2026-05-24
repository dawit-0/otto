import { useState, useEffect, useRef } from 'react';
import type { Database, TableInfo } from '../api';

type View = 'overview' | 'schema' | 'data' | 'query' | 'visualize' | 'ask';

export type PaletteAction =
  | { type: 'navigate'; view: View }
  | { type: 'table'; name: string }
  | { type: 'switch-db'; db: Database };

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  description?: string;
  badge: string;
  badgeVariant: 'view' | 'table' | 'db';
  action: PaletteAction;
}

interface Props {
  databases: Database[];
  activeDb: Database | null;
  tables: TableInfo[];
  onAction: (action: PaletteAction) => void;
  onClose: () => void;
}

const VIEWS: Array<{ id: View; label: string; description: string }> = [
  { id: 'overview', label: 'Overview', description: 'Database summary and recent activity' },
  { id: 'schema', label: 'Schema', description: 'Visual relationship graph' },
  { id: 'data', label: 'Browse Data', description: 'Paginated table browser' },
  { id: 'query', label: 'Query Editor', description: 'Write and execute SQL' },
  { id: 'visualize', label: 'Visualize', description: 'Charts and dashboards' },
  { id: 'ask', label: 'Ask Otto', description: 'Generate queries with AI' },
];

const GROUP_ORDER = ['Navigate', 'Tables', 'Databases'];

function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export default function CommandPalette({ databases, activeDb, tables, onAction, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('.cp-item-selected')?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const allItems: PaletteItem[] = [];

  if (activeDb) {
    for (const v of VIEWS) {
      allItems.push({
        id: `view-${v.id}`,
        group: 'Navigate',
        label: v.label,
        description: v.description,
        badge: 'View',
        badgeVariant: 'view',
        action: { type: 'navigate', view: v.id },
      });
    }
    for (const table of tables) {
      allItems.push({
        id: `table-${table.name}`,
        group: 'Tables',
        label: table.name,
        description: `${table.columns.length} columns · ${table.row_count.toLocaleString()} rows`,
        badge: 'Table',
        badgeVariant: 'table',
        action: { type: 'table', name: table.name },
      });
    }
  }

  for (const db of databases) {
    if (!activeDb || db.id !== activeDb.id) {
      allItems.push({
        id: `db-${db.id}`,
        group: 'Databases',
        label: db.name,
        description: `Switch to ${db.db_type === 'postgres' ? 'PostgreSQL' : 'SQLite'} database`,
        badge: db.db_type === 'postgres' ? 'PG' : 'SQLite',
        badgeVariant: 'db',
        action: { type: 'switch-db', db },
      });
    }
  }

  const filtered = allItems.filter(
    (item) => fuzzyMatch(item.label, query) || fuzzyMatch(item.description ?? '', query),
  );

  const groups = new Map<string, PaletteItem[]>();
  for (const item of filtered) {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group)!.push(item);
  }

  const flatItems: PaletteItem[] = [];
  for (const g of GROUP_ORDER) {
    if (groups.has(g)) flatItems.push(...groups.get(g)!);
  }

  const safeIndex = Math.min(selectedIndex, Math.max(0, flatItems.length - 1));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatItems[safeIndex]) { onAction(flatItems[safeIndex].action); onClose(); }
    }
  };

  let flatIdx = 0;

  return (
    <div className="cp-overlay" onClick={onClose}>
      <div className="cp" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="cp-search-row">
          <svg className="cp-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className="cp-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search views, tables, databases..."
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button className="cp-clear btn-icon" onClick={() => setQuery('')} tabIndex={-1}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="cp-results" ref={listRef}>
          {flatItems.length === 0 ? (
            <div className="cp-empty">
              {query ? `No results for "${query}"` : 'Connect a database to get started'}
            </div>
          ) : (
            GROUP_ORDER.map((groupName) => {
              const items = groups.get(groupName);
              if (!items || items.length === 0) return null;
              return (
                <div key={groupName} className="cp-group">
                  <div className="cp-group-label">{groupName}</div>
                  {items.map((item) => {
                    const idx = flatIdx++;
                    const isSelected = idx === safeIndex;
                    return (
                      <button
                        key={item.id}
                        className={`cp-item${isSelected ? ' cp-item-selected' : ''}`}
                        onClick={() => { onAction(item.action); onClose(); }}
                        onMouseMove={() => setSelectedIndex(idx)}
                        tabIndex={-1}
                      >
                        <div className="cp-item-info">
                          <span className="cp-item-label">{item.label}</span>
                          {item.description && (
                            <span className="cp-item-desc">{item.description}</span>
                          )}
                        </div>
                        <span className={`cp-badge cp-badge-${item.badgeVariant}`}>{item.badge}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="cp-footer">
          <span className="cp-hint"><kbd>↑↓</kbd> navigate</span>
          <span className="cp-hint"><kbd>↵</kbd> select</span>
          <span className="cp-hint"><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
