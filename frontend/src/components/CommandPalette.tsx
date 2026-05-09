import { useState, useEffect, useRef, useCallback } from 'react';
import { type Database, type TableInfo, type SavedQueryEntry } from '../api';

type View = 'schema' | 'data' | 'query' | 'visualize';

interface CommandItem {
  id: string;
  category: 'navigate' | 'database' | 'table' | 'query';
  icon: string;
  title: string;
  subtitle?: string;
  action: () => void;
}

interface Props {
  databases: Database[];
  activeDb: Database | null;
  tables: TableInfo[];
  savedQueries: SavedQueryEntry[];
  onSelectDb: (db: Database) => void;
  onSelectTable: (name: string) => void;
  onSelectView: (view: View) => void;
  onLoadQuery: (sql: string) => void;
  onClose: () => void;
}

function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

function highlight(text: string, query: string): string {
  if (!query) return text;
  return text; // plain text — highlighting handled via CSS class
}

const VIEWS: { view: View; icon: string; label: string }[] = [
  { view: 'schema', icon: '⬡', label: 'Schema — visualize table relationships' },
  { view: 'data', icon: '⊞', label: 'Data — browse table rows' },
  { view: 'query', icon: '›_', label: 'Query — run SQL' },
  { view: 'visualize', icon: '◈', label: 'Visualize — charts & dashboards' },
];

export default function CommandPalette({
  databases,
  activeDb,
  tables,
  savedQueries,
  onSelectDb,
  onSelectTable,
  onSelectView,
  onLoadQuery,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const buildItems = useCallback((): CommandItem[] => {
    const items: CommandItem[] = [];

    // Views
    for (const v of VIEWS) {
      const label = `${v.label.split(' — ')[0]}`;
      const subtitle = v.label.split(' — ')[1];
      if (fuzzyMatch(query, label) || fuzzyMatch(query, subtitle ?? '')) {
        items.push({
          id: `view:${v.view}`,
          category: 'navigate',
          icon: v.icon,
          title: label,
          subtitle,
          action: () => { onSelectView(v.view); onClose(); },
        });
      }
    }

    // Databases
    for (const db of databases) {
      if (fuzzyMatch(query, db.name) || fuzzyMatch(query, db.path)) {
        items.push({
          id: `db:${db.id}`,
          category: 'database',
          icon: '▪',
          title: db.name,
          subtitle: db.path,
          action: () => { onSelectDb(db); onClose(); },
        });
      }
    }

    // Tables (current DB)
    if (activeDb) {
      for (const t of tables) {
        if (fuzzyMatch(query, t.name)) {
          items.push({
            id: `table:${t.name}`,
            category: 'table',
            icon: '⊟',
            title: t.name,
            subtitle: `${t.row_count.toLocaleString()} rows · ${t.columns.length} columns`,
            action: () => { onSelectTable(t.name); onClose(); },
          });
        }
      }
    }

    // Saved queries
    for (const sq of savedQueries) {
      if (fuzzyMatch(query, sq.name) || fuzzyMatch(query, sq.description ?? '') || fuzzyMatch(query, sq.sql)) {
        items.push({
          id: `query:${sq.id}`,
          category: 'query',
          icon: '◇',
          title: sq.name,
          subtitle: sq.description ?? sq.sql.slice(0, 60),
          action: () => { onLoadQuery(sq.sql); onClose(); },
        });
      }
    }

    return items;
  }, [query, databases, activeDb, tables, savedQueries, onSelectDb, onSelectTable, onSelectView, onLoadQuery, onClose]);

  const items = buildItems();

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      items[selectedIndex]?.action();
    }
  };

  const CATEGORY_LABELS: Record<CommandItem['category'], string> = {
    navigate: 'View',
    database: 'Database',
    table: 'Table',
    query: 'Saved Query',
  };

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="cmd-search-row">
          <span className="cmd-search-icon">⌕</span>
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search views, tables, databases, queries…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cmd-esc-hint">esc</kbd>
        </div>

        <div className="cmd-list" ref={listRef}>
          {items.length === 0 && (
            <div className="cmd-empty">No results for "{query}"</div>
          )}
          {items.map((item, idx) => (
            <button
              key={item.id}
              className={`cmd-item${idx === selectedIndex ? ' cmd-item-selected' : ''}`}
              onClick={item.action}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <span className="cmd-item-icon">{item.icon}</span>
              <span className="cmd-item-content">
                <span className="cmd-item-title">{item.title}</span>
                {item.subtitle && (
                  <span className="cmd-item-subtitle">{item.subtitle}</span>
                )}
              </span>
              <span className={`cmd-item-badge cmd-badge-${item.category}`}>
                {CATEGORY_LABELS[item.category]}
              </span>
            </button>
          ))}
        </div>

        <div className="cmd-footer">
          <span className="cmd-hint"><kbd>↑↓</kbd> navigate</span>
          <span className="cmd-hint"><kbd>↵</kbd> select</span>
          <span className="cmd-hint"><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
