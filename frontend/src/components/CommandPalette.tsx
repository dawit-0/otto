import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { api, type TableInfo, type SavedQueryEntry, type QueryHistoryEntry } from '../api';

type View = 'overview' | 'schema' | 'data' | 'query' | 'visualize' | 'ask';

interface Props {
  dbId: string;
  tables: TableInfo[];
  onNavigate: (view: View, table?: string, sql?: string) => void;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  group: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  action: () => void;
}

const VIEW_ITEMS: { view: View; label: string; icon: string; description: string }[] = [
  { view: 'overview', label: 'Overview', icon: '◎', description: 'Database overview and stats' },
  { view: 'schema', label: 'Schema', icon: '⬡', description: 'Visual schema graph' },
  { view: 'data', label: 'Data', icon: '⊞', description: 'Browse table data' },
  { view: 'query', label: 'Query Editor', icon: '>', description: 'Write and run SQL queries' },
  { view: 'visualize', label: 'Visualize', icon: '▦', description: 'Charts and dashboards' },
  { view: 'ask', label: 'Ask Otto', icon: '◆', description: 'Natural language queries' },
];

function fuzzyMatch(text: string, query: string): { matched: boolean; positions: Set<number> } {
  if (!query) return { matched: true, positions: new Set() };
  const lText = text.toLowerCase();
  const lQuery = query.toLowerCase();
  const positions = new Set<number>();
  let qi = 0;
  for (let i = 0; i < lText.length && qi < lQuery.length; i++) {
    if (lText[i] === lQuery[qi]) {
      positions.add(i);
      qi++;
    }
  }
  return { matched: qi === lQuery.length, positions };
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const { matched, positions } = fuzzyMatch(text, query);
  if (!matched || !query) return <>{text}</>;
  return (
    <>
      {text.split('').map((char, i) =>
        positions.has(i)
          ? <mark key={i} className="cmd-highlight">{char}</mark>
          : <span key={i}>{char}</span>
      )}
    </>
  );
}

export default function CommandPalette({ dbId, tables, onNavigate, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [savedQueries, setSavedQueries] = useState<SavedQueryEntry[]>([]);
  const [recentQueries, setRecentQueries] = useState<QueryHistoryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    api.listSavedQueries(dbId).then(setSavedQueries).catch(() => {});
    api.getQueryHistory(dbId, 30).then(setRecentQueries).catch(() => {});
  }, [dbId]);

  const allItems = useMemo<CommandItem[]>(() => {
    const result: CommandItem[] = [];

    for (const v of VIEW_ITEMS) {
      const labelMatch = fuzzyMatch(v.label, query);
      const descMatch = fuzzyMatch(v.description, query);
      if (labelMatch.matched || descMatch.matched) {
        const nav = v;
        result.push({
          id: `view-${v.view}`,
          group: 'Navigate',
          label: v.label,
          description: v.description,
          icon: <span className="cmd-item-icon-glyph">{v.icon}</span>,
          action: () => onNavigate(nav.view),
        });
      }
    }

    for (const t of tables) {
      const { matched } = fuzzyMatch(t.name, query);
      if (matched) {
        const name = t.name;
        result.push({
          id: `table-${t.name}`,
          group: 'Tables',
          label: t.name,
          description: `${t.columns.length} col${t.columns.length !== 1 ? 's' : ''} · ${t.row_count.toLocaleString()} rows`,
          icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M3 15h18M9 3v18" />
            </svg>
          ),
          action: () => onNavigate('data', name),
        });
      }
    }

    for (const sq of savedQueries) {
      const nameMatch = fuzzyMatch(sq.name, query);
      const descMatch = sq.description ? fuzzyMatch(sq.description, query) : { matched: false };
      const sqlMatch = fuzzyMatch(sq.sql, query);
      if (nameMatch.matched || descMatch.matched || sqlMatch.matched) {
        const sql = sq.sql;
        result.push({
          id: `saved-${sq.id}`,
          group: 'Saved Queries',
          label: sq.name,
          description: sq.description || sq.sql.slice(0, 50) + (sq.sql.length > 50 ? '…' : ''),
          icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
          ),
          action: () => onNavigate('query', undefined, sql),
        });
      }
    }

    const seenSql = new Set<string>();
    let recentCount = 0;
    for (const rq of recentQueries) {
      if (rq.status !== 'success') continue;
      if (seenSql.has(rq.sql)) continue;
      seenSql.add(rq.sql);
      const { matched } = fuzzyMatch(rq.sql, query);
      if (!matched) continue;
      const sql = rq.sql;
      const label = rq.sql.length > 55 ? rq.sql.slice(0, 55) + '…' : rq.sql;
      result.push({
        id: `recent-${rq.id}`,
        group: 'Recent',
        label,
        description: rq.row_count != null ? `${rq.row_count} rows` : undefined,
        icon: (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 .49-5.1L1 10" />
          </svg>
        ),
        action: () => onNavigate('query', undefined, sql),
      });
      if (++recentCount >= 5) break;
    }

    return result;
  }, [query, tables, savedQueries, recentQueries, onNavigate]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = allItems[activeIndex];
      if (item) { item.action(); onClose(); }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  // Group items for display while preserving flat indices
  const groups: { name: string; items: { item: CommandItem; index: number }[] }[] = [];
  allItems.forEach((item, index) => {
    let group = groups.find((g) => g.name === item.group);
    if (!group) { group = { name: item.group, items: [] }; groups.push(group); }
    group.items.push({ item, index });
  });

  return createPortal(
    <div className="cmd-overlay" onMouseDown={onClose}>
      <div className="cmd-palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmd-search-row">
          <svg className="cmd-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search tables, queries, views…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cmd-esc-hint">Esc</kbd>
        </div>

        <div className="cmd-results" ref={listRef}>
          {allItems.length === 0 && query && (
            <div className="cmd-empty">No results for &ldquo;{query}&rdquo;</div>
          )}
          {allItems.length === 0 && !query && (
            <div className="cmd-empty">Start typing to search…</div>
          )}

          {groups.map((group) => (
            <div key={group.name} className="cmd-group">
              <div className="cmd-group-label">{group.name}</div>
              {group.items.map(({ item, index }) => (
                <button
                  key={item.id}
                  data-idx={index}
                  className={`cmd-item${index === activeIndex ? ' active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={() => { item.action(); onClose(); }}
                >
                  <span className="cmd-item-icon">{item.icon}</span>
                  <span className="cmd-item-body">
                    <span className="cmd-item-label">
                      <HighlightedText text={item.label} query={query} />
                    </span>
                    {item.description && (
                      <span className="cmd-item-desc">{item.description}</span>
                    )}
                  </span>
                  {index === activeIndex && (
                    <kbd className="cmd-item-enter-hint">↵</kbd>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="cmd-footer">
          <span className="cmd-footer-hint"><kbd>↑↓</kbd> navigate</span>
          <span className="cmd-footer-hint"><kbd>↵</kbd> select</span>
          <span className="cmd-footer-hint"><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
