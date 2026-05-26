import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { api, type Database, type TableInfo, type SavedQueryEntry } from '../api';

type View = 'overview' | 'schema' | 'data' | 'query' | 'visualize' | 'ask';

interface CommandPaletteProps {
  databases: Database[];
  activeDb: Database | null;
  tables: TableInfo[];
  onClose: () => void;
  onNavigate: (view: View) => void;
  onSelectDb: (db: Database) => void;
  onSelectTable: (table: string) => void;
  onConnect: () => void;
  onLoadSql: (sql: string) => void;
}

interface Command {
  id: string;
  label: string;
  sublabel?: string;
  category: string;
  iconText: string;
  iconClass?: string;
  action: () => void;
}

const CATEGORY_ORDER = ['Navigate', 'Actions', 'Databases', 'Tables', 'Saved Queries'];

export default function CommandPalette({
  databases,
  activeDb,
  tables,
  onClose,
  onNavigate,
  onSelectDb,
  onSelectTable,
  onConnect,
  onLoadSql,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [savedQueries, setSavedQueries] = useState<SavedQueryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (activeDb) {
      api.listSavedQueries(activeDb.id).then(setSavedQueries).catch(() => {});
    }
  }, [activeDb]);

  const exec = useCallback((fn: () => void) => { fn(); onClose(); }, [onClose]);

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      {
        id: 'nav-overview', label: 'Overview',
        sublabel: 'Database statistics & table list',
        category: 'Navigate', iconText: '◎',
        action: () => exec(() => onNavigate('overview')),
      },
      {
        id: 'nav-schema', label: 'Schema',
        sublabel: 'Interactive entity-relationship graph',
        category: 'Navigate', iconText: '⬡',
        action: () => exec(() => onNavigate('schema')),
      },
      {
        id: 'nav-data', label: 'Data',
        sublabel: 'Browse & filter table rows',
        category: 'Navigate', iconText: '≡',
        action: () => exec(() => onNavigate('data')),
      },
      {
        id: 'nav-query', label: 'Query',
        sublabel: 'SQL editor with history & saved queries',
        category: 'Navigate', iconText: '>_',
        action: () => exec(() => onNavigate('query')),
      },
      {
        id: 'nav-visualize', label: 'Visualize',
        sublabel: 'Charts & drag-drop dashboards',
        category: 'Navigate', iconText: '◫',
        action: () => exec(() => onNavigate('visualize')),
      },
      {
        id: 'nav-ask', label: 'Ask Otto',
        sublabel: 'Generate SQL from natural language',
        category: 'Navigate', iconText: '◆', iconClass: 'cmd-icon-accent',
        action: () => exec(() => onNavigate('ask')),
      },
      {
        id: 'action-connect', label: 'Connect Database',
        sublabel: 'Add a SQLite file or PostgreSQL connection',
        category: 'Actions', iconText: '+',
        action: () => exec(onConnect),
      },
    ];

    databases.forEach(db => {
      cmds.push({
        id: `db-${db.id}`,
        label: db.name,
        sublabel: db.db_type === 'postgres' ? `PostgreSQL · ${db.path}` : `SQLite · ${db.path}`,
        category: 'Databases',
        iconText: db.db_type === 'postgres' ? 'PG' : 'SL',
        iconClass: db.db_type === 'postgres' ? 'cmd-icon-pg' : 'cmd-icon-sl',
        action: () => exec(() => onSelectDb(db)),
      });
    });

    tables.forEach(table => {
      cmds.push({
        id: `table-${table.name}`,
        label: table.name,
        sublabel: `${table.row_count.toLocaleString()} rows · ${table.columns.length} columns`,
        category: 'Tables', iconText: '▦',
        action: () => exec(() => onSelectTable(table.name)),
      });
    });

    savedQueries.forEach(sq => {
      cmds.push({
        id: `sq-${sq.id}`,
        label: sq.name,
        sublabel: sq.description ?? sq.sql.slice(0, 80),
        category: 'Saved Queries', iconText: '★',
        action: () => exec(() => onLoadSql(sq.sql)),
      });
    });

    return cmds;
  }, [databases, tables, savedQueries, exec, onNavigate, onSelectDb, onSelectTable, onConnect, onLoadSql]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(cmd =>
      cmd.label.toLowerCase().includes(q) ||
      cmd.sublabel?.toLowerCase().includes(q) ||
      cmd.category.toLowerCase().includes(q)
    );
  }, [commands, query]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  useEffect(() => {
    const el = resultsRef.current?.querySelector('[data-selected="true"]') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const grouped = useMemo(() => {
    const map = new Map<string, Command[]>();
    filtered.forEach(cmd => {
      if (!map.has(cmd.category)) map.set(cmd.category, []);
      map.get(cmd.category)!.push(cmd);
    });
    const sorted = new Map<string, Command[]>();
    CATEGORY_ORDER.forEach(cat => { if (map.has(cat)) sorted.set(cat, map.get(cat)!); });
    map.forEach((v, k) => { if (!sorted.has(k)) sorted.set(k, v); });
    return sorted;
  }, [filtered]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); filtered[selectedIndex]?.action(); }
  };

  return (
    <div className="cmd-overlay" onMouseDown={onClose}>
      <div
        className="cmd-modal"
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="cmd-search-bar">
          <svg className="cmd-search-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search commands, tables, queries…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button className="btn-icon cmd-clear" onClick={() => setQuery('')} tabIndex={-1} aria-label="Clear">
              ✕
            </button>
          )}
        </div>

        <div className="cmd-results" ref={resultsRef}>
          {filtered.length === 0 ? (
            <div className="cmd-empty">
              No results for <strong>"{query}"</strong>
            </div>
          ) : (
            Array.from(grouped.entries()).map(([category, cmds]) => (
              <div key={category} className="cmd-group">
                <div className="cmd-group-label">{category}</div>
                {cmds.map(cmd => {
                  const idx = filtered.indexOf(cmd);
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      key={cmd.id}
                      className={`cmd-item${isSelected ? ' selected' : ''}`}
                      data-selected={isSelected ? 'true' : undefined}
                      onMouseMove={() => setSelectedIndex(idx)}
                      onClick={cmd.action}
                      tabIndex={-1}
                    >
                      <span className={`cmd-item-icon${cmd.iconClass ? ` ${cmd.iconClass}` : ''}`}>
                        {cmd.iconText}
                      </span>
                      <span className="cmd-item-body">
                        <span className="cmd-item-label">{cmd.label}</span>
                        {cmd.sublabel && (
                          <span className="cmd-item-sub">{cmd.sublabel}</span>
                        )}
                      </span>
                      {isSelected && <span className="cmd-item-enter" aria-hidden="true">↵</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="cmd-footer">
          <span className="cmd-hint"><kbd>↑↓</kbd> navigate</span>
          <span className="cmd-hint"><kbd>↵</kbd> select</span>
          <span className="cmd-hint"><kbd>esc</kbd> close</span>
          <span className="cmd-hint cmd-hint-right"><kbd>⌘K</kbd></span>
        </div>
      </div>
    </div>
  );
}
