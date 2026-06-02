import { useState, useEffect, useRef, useCallback } from 'react';
import { type Database, type TableInfo, type SavedQueryEntry } from '../api';

type View = 'overview' | 'schema' | 'data' | 'query' | 'visualize' | 'ask';

interface NavAction {
  kind: 'nav';
  id: string;
  label: string;
  icon: string;
  view: View;
  description: string;
}

interface TableAction {
  kind: 'table';
  id: string;
  label: string;
  icon: string;
  tableName: string;
  db: Database;
  rowCount: number;
  columnCount: number;
}

interface ColumnAction {
  kind: 'column';
  id: string;
  label: string;
  icon: string;
  columnName: string;
  tableName: string;
  columnType: string;
  db: Database;
}

interface SavedQueryAction {
  kind: 'saved_query';
  id: string;
  label: string;
  icon: string;
  sql: string;
  description: string | null;
  dbId: string;
  dbName: string;
}

type PaletteAction = NavAction | TableAction | ColumnAction | SavedQueryAction;

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  activeDb: Database | null;
  tables: TableInfo[];
  savedQueries: SavedQueryEntry[];
  onNavigate: (view: View, tableName?: string, sql?: string) => void;
  onSelectDb: (db: Database) => void;
}

const NAV_ACTIONS: NavAction[] = [
  { kind: 'nav', id: 'nav-overview', label: 'Overview', icon: '◈', view: 'overview', description: 'Database stats and table summary' },
  { kind: 'nav', id: 'nav-schema', label: 'Schema', icon: '⬡', view: 'schema', description: 'Interactive ER diagram' },
  { kind: 'nav', id: 'nav-data', label: 'Data', icon: '⊞', view: 'data', description: 'Browse and filter table rows' },
  { kind: 'nav', id: 'nav-query', label: 'Query', icon: '⌥', view: 'query', description: 'Run SQL queries' },
  { kind: 'nav', id: 'nav-visualize', label: 'Visualize', icon: '◉', view: 'visualize', description: 'Chart dashboard' },
  { kind: 'nav', id: 'nav-ask', label: 'Ask Otto', icon: '◆', view: 'ask', description: 'Natural language queries' },
];

function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let hi = 0;
  for (let ni = 0; ni < n.length; ni++) {
    const idx = h.indexOf(n[ni], hi);
    if (idx === -1) return false;
    hi = idx + 1;
  }
  return true;
}

function scoreMatch(label: string, query: string): number {
  const l = label.toLowerCase();
  const q = query.toLowerCase();
  if (l === q) return 3;
  if (l.startsWith(q)) return 2;
  if (l.includes(q)) return 1;
  return 0;
}

export default function CommandPalette({
  open,
  onClose,
  activeDb,
  tables,
  savedQueries,
  onNavigate,
  onSelectDb,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const buildActions = useCallback((): PaletteAction[] => {
    const actions: PaletteAction[] = [];

    actions.push(...NAV_ACTIONS);

    for (const table of tables) {
      const db = activeDb!;
      actions.push({
        kind: 'table',
        id: `table-${db.id}-${table.name}`,
        label: table.name,
        icon: '▦',
        tableName: table.name,
        db,
        rowCount: table.row_count,
        columnCount: table.columns.length,
      });
      for (const col of table.columns) {
        actions.push({
          kind: 'column',
          id: `col-${db.id}-${table.name}-${col.name}`,
          label: col.name,
          icon: col.pk ? '🔑' : '▸',
          columnName: col.name,
          tableName: table.name,
          columnType: col.type,
          db,
        });
      }
    }

    for (const sq of savedQueries) {
      actions.push({
        kind: 'saved_query',
        id: `sq-${sq.id}`,
        label: sq.name,
        icon: '★',
        sql: sq.sql,
        description: sq.description,
        dbId: sq.db_id,
        dbName: sq.db_name,
      });
    }

    return actions;
  }, [activeDb, tables, savedQueries]);

  const getFiltered = useCallback((): PaletteAction[] => {
    if (!query.trim()) {
      const actions = buildActions();
      return actions.filter((a) => a.kind === 'nav' || a.kind === 'table').slice(0, 12);
    }
    const actions = buildActions();
    return actions
      .filter((a) => fuzzyMatch(a.label, query) || (a.kind === 'table' && fuzzyMatch(a.tableName, query)))
      .sort((a, b) => scoreMatch(b.label, query) - scoreMatch(a.label, query))
      .slice(0, 14);
  }, [query, buildActions]);

  const filtered = getFiltered();

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const handleSelect = useCallback((action: PaletteAction) => {
    onClose();
    if (action.kind === 'nav') {
      onNavigate(action.view);
    } else if (action.kind === 'table') {
      if (activeDb?.id !== action.db.id) onSelectDb(action.db);
      onNavigate('data', action.tableName);
    } else if (action.kind === 'column') {
      if (activeDb?.id !== action.db.id) onSelectDb(action.db);
      onNavigate('data', action.tableName);
    } else if (action.kind === 'saved_query') {
      onNavigate('query', undefined, action.sql);
    }
  }, [onClose, onNavigate, onSelectDb, activeDb]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[activeIndex]) handleSelect(filtered[activeIndex]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, filtered, activeIndex, handleSelect]);

  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  const grouped = groupActions(filtered);

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-input-row">
          <span className="cmd-search-icon">⌕</span>
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Go to table, column, saved query, or view…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button className="cmd-clear" onClick={() => setQuery('')}>✕</button>
          )}
          <kbd className="cmd-esc-hint">esc</kbd>
        </div>

        <div className="cmd-results" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="cmd-empty">No results for "{query}"</div>
          ) : (
            grouped.map(({ label: groupLabel, actions }) => (
              <div key={groupLabel} className="cmd-group">
                <div className="cmd-group-label">{groupLabel}</div>
                {actions.map((action) => {
                  const globalIdx = filtered.indexOf(action);
                  return (
                    <div
                      key={action.id}
                      className={`cmd-item${globalIdx === activeIndex ? ' active' : ''}`}
                      onMouseEnter={() => setActiveIndex(globalIdx)}
                      onClick={() => handleSelect(action)}
                    >
                      <span className="cmd-item-icon">{action.icon}</span>
                      <div className="cmd-item-body">
                        <span className="cmd-item-label">
                          <Highlight text={action.label} query={query} />
                        </span>
                        <span className="cmd-item-sub">{getSubtext(action)}</span>
                      </div>
                      {action.kind === 'table' && (
                        <span className="cmd-item-badge">
                          {action.rowCount.toLocaleString()} rows
                        </span>
                      )}
                      {action.kind === 'column' && (
                        <span className="cmd-item-badge cmd-item-badge-type">{action.columnType}</span>
                      )}
                      {(action.kind === 'nav') && (
                        <span className="cmd-item-badge cmd-item-badge-nav">↵</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="cmd-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
          {activeDb && <span className="cmd-footer-db">— {activeDb.name}</span>}
        </div>
      </div>
    </div>
  );
}

interface Group { label: string; actions: PaletteAction[] }

function groupActions(actions: PaletteAction[]): Group[] {
  const order: PaletteAction['kind'][] = ['nav', 'table', 'column', 'saved_query'];
  const labels: Record<PaletteAction['kind'], string> = {
    nav: 'Views',
    table: 'Tables',
    column: 'Columns',
    saved_query: 'Saved Queries',
  };
  const map = new Map<PaletteAction['kind'], PaletteAction[]>();
  for (const a of actions) {
    if (!map.has(a.kind)) map.set(a.kind, []);
    map.get(a.kind)!.push(a);
  }
  return order.filter((k) => map.has(k)).map((k) => ({ label: labels[k], actions: map.get(k)! }));
}

function getSubtext(action: PaletteAction): string {
  if (action.kind === 'nav') return action.description;
  if (action.kind === 'table') return `${action.columnCount} columns · ${action.db.name}`;
  if (action.kind === 'column') return `${action.tableName} · ${action.db.name}`;
  if (action.kind === 'saved_query') return action.description ?? action.dbName;
  return '';
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let qi = 0;
  for (let i = 0; i < text.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      if (i > lastIdx) parts.push(text.slice(lastIdx, i));
      parts.push(<mark key={i} className="cmd-highlight">{text[i]}</mark>);
      lastIdx = i + 1;
      qi++;
    }
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return <>{parts}</>;
}
