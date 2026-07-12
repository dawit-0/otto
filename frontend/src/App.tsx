import { useState, useEffect, useCallback } from 'react';
import { api, type Database, type TableInfo } from './api';
import SchemaGraph from './components/SchemaGraph';
import DataView from './components/DataView';
import MultiTabQueryEditor from './components/MultiTabQueryEditor';
import ConnectModal from './components/ConnectModal';
import VisualizationDashboard from './components/VisualizationDashboard';
import AskOtto from './components/AskOtto';
import OverviewTab from './components/OverviewTab';
import CommandPalette from './components/CommandPalette';
import { type ChartType } from './components/charts/ChartRenderer';

type View = 'overview' | 'schema' | 'data' | 'query' | 'visualize' | 'ask';

export default function App() {
  const [databases, setDatabases] = useState<Database[]>([]);
  const [activeDb, setActiveDb] = useState<Database | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [view, setView] = useState<View>('overview');
  const [showConnect, setShowConnect] = useState(false);
  const [pendingVisualization, setPendingVisualization] = useState<{
    sql: string; chartType: ChartType; xColumn: string; yColumns: string[];
  } | null>(null);
  const [askSeedSql, setAskSeedSql] = useState<string | null>(null);
  const [queryKey, setQueryKey] = useState(0);
  const [showPalette, setShowPalette] = useState(false);

  useEffect(() => {
    api.listDatabases().then((dbs) => {
      if (dbs.length > 0) {
        setDatabases(dbs);
        setActiveDb(dbs[0]);
        loadSchema(dbs[0]);
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (activeDb) setShowPalette(p => !p);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeDb]);

  const loadSchema = useCallback(async (db: Database) => {
    try {
      const schema = await api.getSchema(db.id);
      setTables(schema.tables);
      setSelectedTable(null);
    } catch (e) {
      console.error('Failed to load schema:', e);
    }
  }, []);

  const selectDb = useCallback((db: Database) => {
    setActiveDb(db);
    loadSchema(db);
    setView('overview');
  }, [loadSchema]);

  const handleConnect = (db: Database) => {
    setDatabases((prev) => prev.some((d) => d.id === db.id) ? prev : [...prev, db]);
    selectDb(db);
    setShowConnect(false);
  };

  const handleDisconnect = async (db: Database) => {
    try {
      await api.disconnectDatabase(db.id);
    } catch {
      // Backend may already have removed it — proceed with cleanup
    }
    setDatabases((prev) => prev.filter((d) => d.id !== db.id));
    if (activeDb?.id === db.id) {
      setActiveDb(null);
      setTables([]);
      setSelectedTable(null);
    }
  };

  const handleSelectTable = useCallback((name: string) => {
    setSelectedTable(name);
    setView('data');
  }, []);

  const handleClearTable = useCallback(() => {
    setSelectedTable(null);
  }, []);

  const handleVisualizeQuery = (sql: string, chartType: ChartType, xColumn: string, yColumns: string[]) => {
    setPendingVisualization({ sql, chartType, xColumn, yColumns });
    setView('visualize');
  };

  const handlePaletteLoadQuery = useCallback((sql: string) => {
    setAskSeedSql(sql);
    setQueryKey(k => k + 1);
    setView('query');
  }, []);

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <span>&#9672;</span> Otto
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-title">Databases</div>
          {databases.map((db) => (
            <div
              key={db.id}
              className={`sidebar-item${activeDb?.id === db.id ? ' active' : ''}`}
              onClick={() => selectDb(db)}
            >
              <span className={`db-type-badge ${db.db_type === 'postgres' ? 'pg' : 'sl'}`}>
                {db.db_type === 'postgres' ? 'PG' : 'SL'}
              </span>
              <span className="sidebar-item-name">{db.name}</span>
              <button
                className="btn-icon sidebar-item-remove"
                onClick={(e) => { e.stopPropagation(); handleDisconnect(db); }}
                title="Disconnect"
              >
                &#x2715;
              </button>
            </div>
          ))}
          {databases.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 10px' }}>
              No databases connected
            </div>
          )}
        </div>

        <div className="sidebar-footer">
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setShowConnect(true)}>
            + Connect Database
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="main-content">
        {activeDb ? (
          <>
            <div className="header">
              <button className={`header-tab${view === 'overview' ? ' active' : ''}`} onClick={() => setView('overview')}>
                Overview
              </button>
              <button className={`header-tab${view === 'schema' ? ' active' : ''}`} onClick={() => setView('schema')}>
                Schema
              </button>
              <button className={`header-tab${view === 'data' ? ' active' : ''}`} onClick={() => setView('data')}>
                Data
              </button>
              <button className={`header-tab${view === 'query' ? ' active' : ''}`} onClick={() => setView('query')}>
                Query
              </button>
              <button className={`header-tab${view === 'visualize' ? ' active' : ''}`} onClick={() => setView('visualize')}>
                Visualize
              </button>
              <button className={`header-tab header-tab-ask${view === 'ask' ? ' active' : ''}`} onClick={() => setView('ask')}>
                ◆ Ask Otto
              </button>
              <div style={{ flex: 1 }} />
              <button className="cmd-palette-trigger-btn" onClick={() => setShowPalette(true)} title="Quick search (⌘K)">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <span>Search</span>
                <kbd>⌘K</kbd>
              </button>
            </div>

            {view === 'overview' && (
              <OverviewTab
                dbId={activeDb.id}
                onSelectTable={handleSelectTable}
              />
            )}

            {view === 'schema' && (
              <SchemaGraph
                tables={tables}
                onSelectTable={handleSelectTable}
                selectedTable={selectedTable}
              />
            )}

            {view === 'data' && (
              <DataView
                dbId={activeDb.id}
                tables={tables}
                selectedTable={selectedTable}
                onSelectTable={handleSelectTable}
                onClearTable={handleClearTable}
              />
            )}

            {view === 'query' && (
              <MultiTabQueryEditor
                dbId={activeDb.id}
                dbName={activeDb.name}
                dbType={activeDb.db_type}
                seedSql={askSeedSql ?? undefined}
                seedVersion={queryKey}
                onVisualize={handleVisualizeQuery}
              />
            )}

            {view === 'visualize' && (
              <VisualizationDashboard
                dbId={activeDb.id}
                dbName={activeDb.name}
                dbType={activeDb.db_type}
                initialQuery={pendingVisualization}
                onInitialQueryConsumed={() => setPendingVisualization(null)}
              />
            )}

            {view === 'ask' && (
              <AskOtto
                key={activeDb.id}
                dbId={activeDb.id}
                dbName={activeDb.name}
                onUseSql={(sql) => {
                  setAskSeedSql(sql);
                  setQueryKey((k) => k + 1);
                  setView('query');
                }}
              />
            )}
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">&#9672;</div>
            <div className="empty-state-title">Welcome to Otto</div>
            <div className="empty-state-text">
              Connect a database to get started. You can explore schemas, browse table data, and run SQL queries.
            </div>
            <button className="btn btn-primary" onClick={() => setShowConnect(true)}>
              + Connect Database
            </button>
          </div>
        )}
      </div>

      {showConnect && <ConnectModal onConnect={handleConnect} onClose={() => setShowConnect(false)} />}

      <CommandPalette
        isOpen={showPalette}
        onClose={() => setShowPalette(false)}
        dbId={activeDb?.id ?? null}
        tables={tables}
        onSelectTable={(name) => { setShowPalette(false); handleSelectTable(name); }}
        onLoadQuery={(sql) => { setShowPalette(false); handlePaletteLoadQuery(sql); }}
        onGoVisualize={() => { setShowPalette(false); setView('visualize'); }}
      />
    </div>
  );
}
