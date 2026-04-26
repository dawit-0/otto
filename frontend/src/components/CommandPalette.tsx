import { useState, useEffect, useRef, useMemo } from 'react';
import type { Database, TableInfo, SavedQueryEntry, QueryHistoryEntry } from '../api';

type View = 'schema' | 'data' | 'query' | 'visualize';

type CommandItem =
  | { kind: 'table'; table: TableInfo }
  | { kind: 'saved-query'; query: SavedQueryEntry }
  | { kind: 'recent-query'; entry: QueryHistoryEntry }
  | { kind: 'switch-db'; db: Database }
  | { kind: 'action'; label: string; icon: string; action: () => void };

interface Props {
  databases: Database[];
  activeDb: Database | null;
  tables: TableInfo[];
  savedQueries: SavedQueryEntry[];
  queryHistory: QueryHistoryEntry[];
  onSelectTable: (name: string) => void;
  onSelectDb: (db: Database) => void;
  onLoadQuery: (sql: string) => void;
  onSetView: (view: View) => void;
  onConnect: () => void;
  onClose: () => void;
}

function matchesQuery(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase());
}

export default function CommandPalette({
  databases,
  activeDb,
  tables,
  savedQueries,
  queryHistory,
  onSelectTable,
  onSelectDb,
  onLoadQuery,
  onSetView,
  onConnect,
  onClose,
}: Props) {
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const execute = (item: CommandItem) => {
    switch (item.kind) {
      case 'table':
        onSelectTable(item.table.name);
        onClose();
        break;
      case 'saved-query':
        onLoadQuery(item.query.sql);
        onSetView('query');
        onClose();
        break;
      case 'recent-query':
        onLoadQuery(item.entry.sql);
        onSetView('query');
        onClose();
        break;
      case 'switch-db':
        onSelectDb(item.db);
        onClose();
        break;
      case 'action':
        item.action();
        break;
    }
  };

  const items = useMemo((): CommandItem[] => {
    const q = search.trim();
    const result: CommandItem[] = [];

    // Tables
    for (const table of tables.filter(t => !q || matchesQuery(t.name, q)).slice(0, 6)) {
      result.push({ kind: 'table', table });
    }

    // Saved queries
    for (const query of savedQueries
      .filter(sq => !q || matchesQuery(sq.name, q) || matchesQuery(sq.sql, q) || (sq.description ? matchesQuery(sq.description, q) : false))
      .slice(0, 4)) {
      result.push({ kind: 'saved-query', query });
    }

    // Recent queries — deduplicated by SQL prefix
    const seen = new Set<string>();
    for (const entry of queryHistory
      .filter(h => h.status === 'success' && (!q || matchesQuery(h.sql, q)))
      .filter(h => {
        const key = h.sql.trim().substring(0, 80);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4)) {
      result.push({ kind: 'recent-query', entry });
    }

    // Switch to another database
    for (const db of databases.filter(d => d.id !== activeDb?.id && (!q || matchesQuery(d.name, q)))) {
      result.push({ kind: 'switch-db', db });
    }

    // Actions
    const actions: { label: string; icon: string; match: string; action: () => void }[] = [
      { label: 'Schema view', icon: '⬡', match: 'schema view', action: () => { onSetView('schema'); onClose(); } },
      { label: 'Query editor', icon: '⌨', match: 'query editor sql', action: () => { onSetView('query'); onClose(); } },
      { label: 'Visualize', icon: '◈', match: 'visualize dashboard chart', action: () => { onSetView('visualize'); onClose(); } },
      { label: 'Connect database', icon: '+', match: 'connect database add', action: () => { onConnect(); onClose(); } },
    ];
    for (const a of actions) {
      if (!q || matchesQuery(a.match, q)) {
        result.push({ kind: 'action', label: a.label, icon: a.icon, action: a.action });
      }
    }

    return result;
  }, [search, tables, savedQueries, queryHistory, databases, activeDb, onSetView, onConnect, onClose]);

  useEffect(() => {
    setActiveIndex(0);
  }, [search]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(i => Math.min(i + 1, items.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(i => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' && items[activeIndex]) {
        e.preventDefault();
        execute(items[activeIndex]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, activeIndex, onClose]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Group items by type for section labels
  const grouped = useMemo(() => {
    const sections: { label: string; items: { item: CommandItem; index: number }[] }[] = [];
    let currentSection = '';
    let idx = 0;
    for (const item of items) {
      const section =
        item.kind === 'table' ? 'Tables' :
        item.kind === 'saved-query' ? 'Saved Queries' :
        item.kind === 'recent-query' ? 'Recent' :
        item.kind === 'switch-db' ? 'Databases' :
        'Actions';
      if (section !== currentSection) {
        currentSection = section;
        sections.push({ label: section, items: [] });
      }
      sections[sections.length - 1].items.push({ item, index: idx++ });
    }
    return sections;
  }, [items]);

  const renderItem = (item: CommandItem, index: number) => {
    const isActive = index === activeIndex;
    const cls = `cmd-item${isActive ? ' cmd-item-active' : ''}`;

    switch (item.kind) {
      case 'table':
        return (
          <button key={`t-${item.table.name}`} className={cls} data-index={index}
            onClick={() => execute(item)} onMouseEnter={() => setActiveIndex(index)}>
            <span className="cmd-item-icon cmd-icon-table">⊞</span>
            <span className="cmd-item-label">{item.table.name}</span>
            <span className="cmd-item-meta">{item.table.row_count.toLocaleString()} rows</span>
          </button>
        );
      case 'saved-query':
        return (
          <button key={`sq-${item.query.id}`} className={cls} data-index={index}
            onClick={() => execute(item)} onMouseEnter={() => setActiveIndex(index)}>
            <span className="cmd-item-icon cmd-icon-saved">★</span>
            <span className="cmd-item-label">{item.query.name}</span>
            <span className="cmd-item-meta cmd-item-mono">{item.query.sql.trim().replace(/\s+/g, ' ').substring(0, 55)}</span>
          </button>
        );
      case 'recent-query':
        return (
          <button key={`rq-${item.entry.id}`} className={cls} data-index={index}
            onClick={() => execute(item)} onMouseEnter={() => setActiveIndex(index)}>
            <span className="cmd-item-icon cmd-icon-recent">↺</span>
            <span className="cmd-item-label cmd-item-mono">{item.entry.sql.trim().replace(/\s+/g, ' ').substring(0, 80)}</span>
          </button>
        );
      case 'switch-db':
        return (
          <button key={`db-${item.db.id}`} className={cls} data-index={index}
            onClick={() => execute(item)} onMouseEnter={() => setActiveIndex(index)}>
            <span className="cmd-item-icon cmd-icon-db">⬡</span>
            <span className="cmd-item-label">{item.db.name}</span>
            <span className="cmd-item-meta">Switch database</span>
          </button>
        );
      case 'action':
        return (
          <button key={`a-${item.label}`} className={cls} data-index={index}
            onClick={() => execute(item)} onMouseEnter={() => setActiveIndex(index)}>
            <span className="cmd-item-icon cmd-icon-action">{item.icon}</span>
            <span className="cmd-item-label">{item.label}</span>
          </button>
        );
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()}>
        <div className="cmd-search-row">
          <span className="cmd-search-icon">⌕</span>
          <input
            ref={inputRef}
            className="cmd-search-input"
            placeholder="Jump to table, run query, switch database…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="cmd-clear-btn" onClick={() => setSearch('')}>✕</button>
          )}
        </div>

        {items.length > 0 ? (
          <div className="cmd-results" ref={listRef}>
            {grouped.map(section => (
              <div key={section.label} className="cmd-section">
                <div className="cmd-section-label">{section.label}</div>
                {section.items.map(({ item, index }) => renderItem(item, index))}
              </div>
            ))}
          </div>
        ) : (
          <div className="cmd-empty">
            No results for <em>"{search}"</em>
          </div>
        )}

        <div className="cmd-footer">
          <span><kbd className="cmd-kbd">↑↓</kbd> navigate</span>
          <span><kbd className="cmd-kbd">↵</kbd> select</span>
          <span><kbd className="cmd-kbd">Esc</kbd> close</span>
          <span style={{ marginLeft: 'auto' }}>
            <kbd className="cmd-kbd">⌘K</kbd> to reopen
          </span>
        </div>
      </div>
    </div>
  );
}
