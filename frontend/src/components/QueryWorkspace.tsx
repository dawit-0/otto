import { useState, useEffect, useRef, useCallback } from 'react';
import QueryEditor from './QueryEditor';
import { type ChartType } from './charts/ChartRenderer';

interface Tab {
  id: string;
  name: string;
  initialSql?: string;
}

interface Seed {
  sql: string;
  version: number;
}

interface Props {
  dbId: string;
  dbName: string;
  dbType?: 'sqlite' | 'postgres';
  onVisualize?: (sql: string, chartType: ChartType, xColumn: string, yColumns: string[]) => void;
  seed?: Seed | null;
}

export default function QueryWorkspace({ dbId, dbName, dbType, onVisualize, seed }: Props) {
  const tabCounterRef = useRef(0);
  const prevSeedVersionRef = useRef<number | undefined>(undefined);

  const newId = () => `tab-${Date.now()}-${(Math.random() * 1e6 | 0)}`;
  const newName = (ai?: boolean) =>
    ai ? 'AI Query' : `Query ${++tabCounterRef.current}`;
  const makeTab = (sql?: string, ai?: boolean): Tab =>
    ({ id: newId(), name: newName(ai), initialSql: sql });

  const [tabs, setTabs] = useState<Tab[]>(() => {
    const first = seed?.sql
      ? makeTab(seed.sql, true)
      : makeTab();
    if (seed) prevSeedVersionRef.current = seed.version;
    return [first];
  });
  const [activeId, setActiveId] = useState(tabs[0].id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Open a new tab when a seed query arrives
  useEffect(() => {
    if (!seed) return;
    if (seed.version === prevSeedVersionRef.current) return;
    prevSeedVersionRef.current = seed.version;
    const tab = makeTab(seed.sql, true);
    setTabs(prev => [...prev, tab]);
    setActiveId(tab.id);
  }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps

  const addTab = useCallback(() => {
    const tab = makeTab();
    setTabs(prev => [...prev, tab]);
    setActiveId(tab.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex(t => t.id === id);
      const next = prev.filter(t => t.id !== id);
      setActiveId(curr => curr === id ? next[Math.min(idx, next.length - 1)].id : curr);
      return next;
    });
  }, []);

  const startRename = (tab: Tab, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(tab.id);
    setEditingName(tab.name);
    setTimeout(() => editInputRef.current?.select(), 0);
  };

  const commitRename = () => {
    if (!editingId) return;
    const trimmed = editingName.trim();
    if (trimmed) setTabs(prev => prev.map(t => t.id === editingId ? { ...t, name: trimmed } : t));
    setEditingId(null);
  };

  // Cmd/Ctrl+T → new tab, Cmd/Ctrl+W → close active tab
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 't') { e.preventDefault(); addTab(); }
      if (e.key === 'w') { e.preventDefault(); closeTab(activeId); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeId, addTab, closeTab]);

  return (
    <div className="query-workspace">
      <div className="query-tabs">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`query-tab${tab.id === activeId ? ' active' : ''}`}
            onClick={() => setActiveId(tab.id)}
            onDoubleClick={(e) => startRename(tab, e)}
            title="Double-click to rename"
          >
            {editingId === tab.id ? (
              <input
                ref={editInputRef}
                className="query-tab-name-input"
                value={editingName}
                onChange={e => setEditingName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onClick={e => e.stopPropagation()}
                autoFocus
              />
            ) : (
              <span className="query-tab-name">{tab.name}</span>
            )}
            {tabs.length > 1 && (
              <button
                className="query-tab-close"
                onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
                title="Close tab"
                aria-label="Close tab"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button className="query-tab-add" onClick={addTab} title="New query tab (⌘T)" aria-label="New tab">
          +
        </button>
        <div className="query-tab-hint">Double-click tab to rename · ⌘T new · ⌘W close</div>
      </div>

      <div className="query-workspace-content">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className="query-workspace-pane"
            style={{ display: tab.id === activeId ? 'flex' : 'none' }}
          >
            <QueryEditor
              dbId={dbId}
              dbName={dbName}
              dbType={dbType}
              initialSql={tab.initialSql}
              onVisualize={onVisualize}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
