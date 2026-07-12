import { useState, useEffect, useCallback, useRef } from 'react';
import QueryEditor from './QueryEditor';
import { type ChartType } from './charts/ChartRenderer';

interface QueryTab {
  id: string;
  label: string;
  sql: string;
}

interface TabsState {
  tabs: QueryTab[];
  activeId: string;
}

interface Props {
  dbId: string;
  dbName: string;
  dbType?: 'sqlite' | 'postgres';
  seedSql?: string;
  seedVersion?: number;
  onVisualize?: (sql: string, chartType: ChartType, xColumn: string, yColumns: string[]) => void;
}

let _seq = 0;

function mkTab(sql = ''): QueryTab {
  _seq += 1;
  return { id: `qt${_seq}`, label: `Query ${_seq}`, sql };
}

function initState(): TabsState {
  _seq = 0;
  const t = mkTab();
  return { tabs: [t], activeId: t.id };
}

export default function MultiTabQueryEditor({ dbId, dbName, dbType, seedSql, seedVersion, onVisualize }: Props) {
  const [state, setState] = useState<TabsState>(() => initState());
  const [editorKey, setEditorKey] = useState(0);
  const prevSeedVersionRef = useRef<number | undefined>(undefined);

  const { tabs, activeId } = state;
  const activeTab = tabs.find(t => t.id === activeId) ?? tabs[0];

  // Reset all tabs when the database changes
  useEffect(() => {
    setState(initState());
    setEditorKey(k => k + 1);
  }, [dbId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle seeded SQL from Ask Otto / history / command palette
  useEffect(() => {
    if (!seedSql || seedVersion === prevSeedVersionRef.current) return;
    prevSeedVersionRef.current = seedVersion;

    setState(prev => {
      const current = prev.tabs.find(t => t.id === prev.activeId);
      if (current && !current.sql.trim()) {
        // Reuse the empty active tab
        return {
          ...prev,
          tabs: prev.tabs.map(t => t.id === prev.activeId ? { ...t, sql: seedSql } : t),
        };
      }
      // Open the SQL in a fresh tab
      const t = mkTab(seedSql);
      return { tabs: [...prev.tabs, t], activeId: t.id };
    });
    setEditorKey(k => k + 1);
  }, [seedVersion, seedSql]);

  const addTab = useCallback(() => {
    const t = mkTab();
    setState(prev => ({ tabs: [...prev.tabs, t], activeId: t.id }));
    setEditorKey(k => k + 1);
  }, []);

  const switchTab = useCallback((id: string) => {
    setState(prev => {
      if (id === prev.activeId) return prev;
      return { ...prev, activeId: id };
    });
    setEditorKey(k => k + 1);
  }, []);

  const closeTab = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setState(prev => {
      if (prev.tabs.length <= 1) return prev;
      const idx = prev.tabs.findIndex(t => t.id === id);
      const next = prev.tabs.filter(t => t.id !== id);
      const nextActiveId = id === prev.activeId
        ? next[Math.max(0, idx - 1)].id
        : prev.activeId;
      if (id === prev.activeId) setEditorKey(k => k + 1);
      return { tabs: next, activeId: nextActiveId };
    });
  }, []);

  const handleSqlChange = useCallback((sql: string) => {
    setState(prev => ({
      ...prev,
      tabs: prev.tabs.map(t => t.id === prev.activeId ? { ...t, sql } : t),
    }));
  }, []);

  // Keyboard shortcut: Cmd/Ctrl+T → new tab
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 't') {
        e.preventDefault();
        addTab();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [addTab]);

  return (
    <div className="multi-tab-query">
      <div className="query-tab-bar">
        <div className="query-tab-bar-tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`query-tab${tab.id === activeId ? ' active' : ''}`}
              onClick={() => switchTab(tab.id)}
              title={tab.label}
            >
              <span className="query-tab-label">{tab.label}</span>
              {tabs.length > 1 && (
                <span
                  className="query-tab-close"
                  onClick={(e) => closeTab(tab.id, e)}
                  title="Close tab"
                  role="button"
                  aria-label={`Close ${tab.label}`}
                >
                  ×
                </span>
              )}
            </button>
          ))}
        </div>
        <button className="query-tab-add" onClick={addTab} title="New tab (⌘T)">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      <QueryEditor
        key={`${dbId}-${activeTab.id}-${editorKey}`}
        dbId={dbId}
        dbName={dbName}
        dbType={dbType}
        initialSql={activeTab.sql}
        onVisualize={onVisualize}
        onSqlChange={handleSqlChange}
      />
    </div>
  );
}
