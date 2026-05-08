import { useState, useEffect, useRef, useCallback } from 'react';
import { api, type TableInfo, type SavedQueryEntry, type QueryHistoryEntry } from '../api';

type View = 'schema' | 'data' | 'query' | 'visualize';

type PaletteItem =
  | { kind: 'table'; name: string; rowCount: number }
  | { kind: 'saved-query'; id: number; name: string; sql: string; description: string | null }
  | { kind: 'recent-query'; id: number; sql: string }
  | { kind: 'action'; id: string; label: string; hint: string; icon: string };

interface Props {
  open: boolean;
  onClose: () => void;
  tables: TableInfo[];
  dbId: string | null;
  onSelectTable: (name: string) => void;
  onSelectQuery: (sql: string) => void;
  onNavigate: (view: View) => void;
  onConnect: () => void;
}

function matches(text: string, query: string): boolean {
  if (!query) return true;
  return text.toLowerCase().includes(query.toLowerCase());
}

const ACTIONS: Extract<PaletteItem, { kind: 'action' }>[] = [
  { kind: 'action', id: 'schema', label: 'Go to Schema', hint: 'View table relationships', icon: '⬡' },
  { kind: 'action', id: 'query', label: 'Open Query Editor', hint: 'Write and run SQL', icon: '▷' },
  { kind: 'action', id: 'visualize', label: 'Open Visualizations', hint: 'Charts and dashboards', icon: '◈' },
  { kind: 'action', id: 'connect', label: 'Connect Database', hint: 'Add a new SQLite database', icon: '+' },
];

const GROUP_LABELS: Record<string, string> = {
  table: 'Tables',
  'saved-query': 'Saved Queries',
  'recent-query': 'Recent Queries',
  action: 'Actions',
};

export default function CommandPalette({
  open, onClose, tables, dbId, onSelectTable, onSelectQuery, onNavigate, onConnect,
}: Props) {
  const [search, setSearch] = useState('');
  const [savedQueries, setSavedQueries] = useState<SavedQueryEntry[]>([]);
  const [recentQueries, setRecentQueries] = useState<QueryHistoryEntry[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setActiveIdx(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    if (dbId) {
      api.listSavedQueries(dbId).then(setSavedQueries).catch(() => {});
      api.getQueryHistory(dbId, 8)
        .then(r => setRecentQueries(r.filter(q => q.status === 'success')))
        .catch(() => {});
    } else {
      setSavedQueries([]);
      setRecentQueries([]);
    }
  }, [open, dbId]);

  const items: PaletteItem[] = [
    ...tables
      .filter(t => matches(t.name, search))
      .slice(0, 8)
      .map(t => ({ kind: 'table' as const, name: t.name, rowCount: t.row_count })),
    ...savedQueries
      .filter(q => matches(q.name, search) || matches(q.sql, search))
      .slice(0, 5)
      .map(q => ({ kind: 'saved-query' as const, id: q.id, name: q.name, sql: q.sql, description: q.description })),
    ...(search
      ? recentQueries.filter(q => matches(q.sql, search)).slice(0, 4)
      : recentQueries.slice(0, 3)
    ).map(q => ({ kind: 'recent-query' as const, id: q.id, sql: q.sql })),
    ...ACTIONS.filter(a => !search || matches(a.label, search) || matches(a.hint, search)),
  ];

  const activate = useCallback((item: PaletteItem) => {
    onClose();
    if (item.kind === 'table') {
      onSelectTable(item.name);
    } else if (item.kind === 'saved-query' || item.kind === 'recent-query') {
      onSelectQuery(item.sql);
      onNavigate('query');
    } else if (item.kind === 'action') {
      if (item.id === 'connect') onConnect();
      else onNavigate(item.id as View);
    }
  }, [onClose, onSelectTable, onSelectQuery, onNavigate, onConnect]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, items.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter') { e.preventDefault(); if (items[activeIdx]) activate(items[activeIdx]); }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [open, items, activeIdx, activate, onClose]);

  useEffect(() => { setActiveIdx(0); }, [search]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  if (!open) return null;

  const elements: React.ReactNode[] = [];
  let lastKind = '';
  items.forEach((item, idx) => {
    if (item.kind !== lastKind) {
      elements.push(
        <div key={`hdr-${item.kind}`} className="cmd-group-label">
          {GROUP_LABELS[item.kind]}
        </div>
      );
      lastKind = item.kind;
    }
    const isActive = idx === activeIdx;
    const itemKey = item.kind === 'table' ? item.name : item.kind === 'action' ? item.id : String(item.id);
    elements.push(
      <div
        key={`${item.kind}-${itemKey}`}
        data-idx={idx}
        className={`cmd-item${isActive ? ' cmd-item-active' : ''}`}
        onMouseEnter={() => setActiveIdx(idx)}
        onClick={() => activate(item)}
      >
        {item.kind === 'table' && (
          <>
            <span className="cmd-item-icon cmd-icon-table">⊞</span>
            <span className="cmd-item-name">{item.name}</span>
            <span className="cmd-item-meta">{item.rowCount.toLocaleString()} rows</span>
          </>
        )}
        {item.kind === 'saved-query' && (
          <>
            <span className="cmd-item-icon cmd-icon-saved">★</span>
            <div className="cmd-item-body">
              <span className="cmd-item-name">{item.name}</span>
              {item.description && <span className="cmd-item-sub">{item.description}</span>}
            </div>
            <span className="cmd-item-meta cmd-item-sql">{item.sql.replace(/\s+/g, ' ').slice(0, 48)}</span>
          </>
        )}
        {item.kind === 'recent-query' && (
          <>
            <span className="cmd-item-icon cmd-icon-recent">↺</span>
            <span className="cmd-item-name cmd-item-sql">{item.sql.replace(/\s+/g, ' ')}</span>
          </>
        )}
        {item.kind === 'action' && (
          <>
            <span className="cmd-item-icon cmd-icon-action">{item.icon}</span>
            <span className="cmd-item-name">{item.label}</span>
            <span className="cmd-item-meta">{item.hint}</span>
          </>
        )}
      </div>
    );
  });

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()}>
        <div className="cmd-search-row">
          <span className="cmd-search-icon">⌘</span>
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search tables, queries, or actions..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {search && (
            <button className="btn-icon cmd-clear-btn" onClick={() => setSearch('')} title="Clear">✕</button>
          )}
        </div>

        <div className="cmd-list" ref={listRef}>
          {items.length === 0 ? (
            <div className="cmd-empty">No results{search ? ` for "${search}"` : ''}</div>
          ) : elements}
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
