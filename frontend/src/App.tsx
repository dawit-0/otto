import { useState, useEffect, useCallback } from 'react';
import { api, type Database, type TableInfo } from './api';
import SchemaGraph from './components/SchemaGraph';
import DataTable from './components/DataTable';
import QueryEditor from './components/QueryEditor';
import ConnectModal from './components/ConnectModal';
import VisualizationDashboard from './components/VisualizationDashboard';
import { type ChartType } from './components/charts/ChartRenderer';

type View = 'schema' | 'data' | 'query' | 'visualize';

interface DataFilter {
  sortColumn: string | null;
  sortOrder: 'asc' | 'desc';
  search: string;
}

const DEFAULT_FILTER: DataFilter = { sortColumn: null, sortOrder: 'asc', search: '' };

export default function App() {
  const [databases, setDatabases] = useState<Database[]>([]);
  const [activeDb, setActiveDb] = useState<Database | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [view, setView] = useState<View>('schema');
  const [showConnect, setShowConnect] = useState(false);
  const [pendingVisualization, setPendingVisualization] = useState<{
    sql: string; chartType: ChartType; xColumn: string; yColumns: string[];
  } | null>(null);

  // Table data state
  const [tableData, setTableData] = useState<{ columns: string[]; rows: Record<string, unknown>[]; total: number } | null>(null);
  const [dataOffset, setDataOffset] = useState(0);
  const [dataFilter, setDataFilter] = useState<DataFilter>(DEFAULT_FILTER);
  const DATA_LIMIT = 100;

  useEffect(() => {
    api.listDatabases().then((dbs) => {
      if (dbs.length > 0) {
        setDatabases(dbs);
        setActiveDb(dbs[0]);
        loadSchema(dbs[0]);
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSchema = useCallback(async (db: Database) => {
    try {
      const schema = await api.getSchema(db.id);
      setTables(schema.tables);
      setSelectedTable(null);
      setTableData(null);
    } catch (e) {
      console.error('Failed to load schema:', e);
    }
  }, []);

  const selectDb = useCallback((db: Database) => {
    setActiveDb(db);
    loadSchema(db);
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
      setTableData(null);
    }
  };

  const loadTableData = useCallback(async (tableName: string, offset = 0, filter: DataFilter = DEFAULT_FILTER) => {
    if (!activeDb) return;
    try {
      const data = await api.getTableData(
        activeDb.id,
        tableName,
        DATA_LIMIT,
        offset,
        filter.sortColumn ?? undefined,
        filter.sortColumn ? filter.sortOrder : undefined,
        filter.search || undefined,
      );
      setTableData({ columns: data.columns, rows: data.rows, total: data.total });
      setDataOffset(offset);
    } catch (e) {
      console.error('Failed to load table data:', e);
    }
  }, [activeDb]);

  const handleSelectTable = useCallback((name: string) => {
    setSelectedTable(name);
    setView('data');
    setDataFilter(DEFAULT_FILTER);
    loadTableData(name, 0, DEFAULT_FILTER);
  }, [loadTableData]);

  const handlePageChange = (offset: number) => {
    if (selectedTable) loadTableData(selectedTable, offset, dataFilter);
  };

  const handleSortChange = (column: string) => {
    const newFilter: DataFilter = {
      ...dataFilter,
      sortColumn: column,
      sortOrder: dataFilter.sortColumn === column && dataFilter.sortOrder === 'asc' ? 'desc' : 'asc',
    };
    setDataFilter(newFilter);
    if (selectedTable) loadTableData(selectedTable, 0, newFilter);
  };

  const handleSearchChange = (search: string) => {
    const newFilter: DataFilter = { ...dataFilter, search };
    setDataFilter(newFilter);
    if (selectedTable) loadTableData(selectedTable, 0, newFilter);
  };

  const handleClearFilters = () => {
    setDataFilter(DEFAULT_FILTER);
    if (selectedTable) loadTableData(selectedTable, 0, DEFAULT_FILTER);
  };

  const handleVisualizeQuery = (sql: string, chartType: ChartType, xColumn: string, yColumns: string[]) => {
    setPendingVisualization({ sql, chartType, xColumn, yColumns });
    setView('visualize');
  };

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
              <span style={{ fontSize: 14 }}>&#9632;</span>
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
              <button className={`header-tab${view === 'schema' ? ' active' : ''}`} onClick={() => setView('schema')}>
                Schema
              </button>
              <button className={`header-tab${view === 'data' ? ' active' : ''}`} onClick={() => setView('data')}>
                Data {selectedTable && `— ${selectedTable}`}
              </button>
              <button className={`header-tab${view === 'query' ? ' active' : ''}`} onClick={() => setView('query')}>
                Query
              </button>
              <button className={`header-tab${view === 'visualize' ? ' active' : ''}`} onClick={() => setView('visualize')}>
                Visualize
              </button>
            </div>

            {view === 'schema' && (
              <SchemaGraph
                tables={tables}
                onSelectTable={handleSelectTable}
                selectedTable={selectedTable}
              />
            )}

            {view === 'data' && selectedTable && tableData && (
              <>
                <div className="table-browser-header">
                  <span className="table-browser-title">{selectedTable}</span>
                  <span className="table-browser-info">{tableData.total.toLocaleString()} rows</span>
                </div>
                <DataTable
                  key={selectedTable}
                  columns={tableData.columns}
                  rows={tableData.rows}
                  total={tableData.total}
                  limit={DATA_LIMIT}
                  offset={dataOffset}
                  onPageChange={handlePageChange}
                  exportFilename={selectedTable}
                  sortColumn={dataFilter.sortColumn}
                  sortOrder={dataFilter.sortOrder}
                  onSortChange={handleSortChange}
                  onSearchChange={handleSearchChange}
                  onClearFilters={handleClearFilters}
                  hasActiveFilters={!!dataFilter.search || !!dataFilter.sortColumn}
                />
              </>
            )}

            {view === 'data' && !selectedTable && (
              <div className="empty-state">
                <div className="empty-state-icon">&#9783;</div>
                <div className="empty-state-title">Select a table</div>
                <div className="empty-state-text">
                  Click a table in the Schema view or sidebar to browse its data.
                </div>
              </div>
            )}

            {view === 'query' && (
              <QueryEditor
                dbId={activeDb.id}
                dbName={activeDb.name}
                onVisualize={handleVisualizeQuery}
              />
            )}

            {view === 'visualize' && (
              <VisualizationDashboard
                dbId={activeDb.id}
                dbName={activeDb.name}
                initialQuery={pendingVisualization}
                onInitialQueryConsumed={() => setPendingVisualization(null)}
              />
            )}
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">&#9672;</div>
            <div className="empty-state-title">Welcome to Otto</div>
            <div className="empty-state-text">
              Connect a SQLite database to get started. You can explore schemas, browse table data, and run SQL queries.
            </div>
            <button className="btn btn-primary" onClick={() => setShowConnect(true)}>
              + Connect Database
            </button>
          </div>
        )}
      </div>

      {showConnect && <ConnectModal onConnect={handleConnect} onClose={() => setShowConnect(false)} />}
    </div>
  );
}
