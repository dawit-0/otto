import { useState, useEffect, useCallback } from 'react';
import { Responsive, useContainerWidth, type LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  api,
  type SavedVisualization,
  type VisualizationHistoryEntry,
} from '../api';
import ChartRenderer, { type ChartType } from './charts/ChartRenderer';
import VisualizationEditor from './VisualizationEditor';

interface Props {
  dbId: string;
  dbName: string;
}

interface PanelData {
  panel: SavedVisualization;
  columns: string[];
  rows: Record<string, unknown>[];
  loading: boolean;
  error: string | null;
}

export default function VisualizationDashboard({ dbId, dbName }: Props) {
  const [panels, setPanels] = useState<PanelData[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [editingPanel, setEditingPanel] = useState<SavedVisualization | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<VisualizationHistoryEntry[]>([]);
  const [loadingPanels, setLoadingPanels] = useState(true);
  const [containerRef, containerWidth] = useContainerWidth();

  const [historyInitial, setHistoryInitial] = useState<{
    title?: string; sql?: string; chart_type?: string;
    config?: Record<string, unknown> | null;
  } | undefined>(undefined);

  const loadPanels = useCallback(async () => {
    setLoadingPanels(true);
    try {
      const saved = await api.listVisualizations(dbId);
      const panelDataList: PanelData[] = saved.map((p) => ({
        panel: p,
        columns: [],
        rows: [],
        loading: true,
        error: null,
      }));
      setPanels(panelDataList);

      const results = await Promise.allSettled(
        saved.map((p) => api.runVisualization(dbId, p.sql, p.chart_type, p.title, p.config as Record<string, unknown> | undefined))
      );

      setPanels((prev) =>
        prev.map((pd, i) => {
          const result = results[i];
          if (result.status === 'fulfilled') {
            return { ...pd, columns: result.value.columns, rows: result.value.rows, loading: false };
          }
          return { ...pd, loading: false, error: result.reason?.message || 'Failed to load' };
        })
      );
    } catch {
      // silently handle
    } finally {
      setLoadingPanels(false);
    }
  }, [dbId]);

  useEffect(() => {
    loadPanels();
  }, [loadPanels]);

  const fetchHistory = useCallback(async () => {
    try {
      const entries = await api.getVisualizationHistory(dbId);
      setHistory(entries);
    } catch {
      // non-critical
    }
  }, [dbId]);

  useEffect(() => {
    if (showHistory) fetchHistory();
  }, [showHistory, fetchHistory]);

  const handleLayoutChange = useCallback(
    (layout: LayoutItem[]) => {
      if (panels.length === 0) return;
      const updates = layout.map((l) => ({
        id: Number(l.i),
        grid_x: l.x,
        grid_y: l.y,
        grid_w: l.w,
        grid_h: l.h,
      }));
      setPanels((prev) =>
        prev.map((pd) => {
          const u = updates.find((u) => u.id === pd.panel.id);
          if (u) {
            return { ...pd, panel: { ...pd.panel, grid_x: u.grid_x, grid_y: u.grid_y, grid_w: u.grid_w, grid_h: u.grid_h } };
          }
          return pd;
        })
      );
      api.updateVisualizationLayout(updates).catch(() => {});
    },
    [panels.length]
  );

  const handlePin = async (data: {
    title: string; sql: string; chart_type: string;
    config: Record<string, unknown>; columns: string[]; rows: Record<string, unknown>[];
  }) => {
    try {
      const maxY = panels.reduce((max, pd) => Math.max(max, pd.panel.grid_y + pd.panel.grid_h), 0);
      const saved = await api.saveVisualization({
        db_id: dbId,
        db_name: dbName,
        title: data.title,
        sql: data.sql,
        chart_type: data.chart_type,
        config: data.config,
        grid_x: 0,
        grid_y: maxY,
        grid_w: 6,
        grid_h: 4,
      });
      setPanels((prev) => [
        ...prev,
        { panel: saved, columns: data.columns, rows: data.rows, loading: false, error: null },
      ]);
      setShowEditor(false);
      setEditingPanel(null);
    } catch {
      // keep editor open on error
    }
  };

  const handleDelete = async (id: number) => {
    await api.deleteVisualization(id);
    setPanels((prev) => prev.filter((pd) => pd.panel.id !== id));
  };

  const handleEdit = (panel: SavedVisualization) => {
    setEditingPanel(panel);
    setShowEditor(true);
  };

  const handleRefresh = async (panelId: number) => {
    const pd = panels.find((p) => p.panel.id === panelId);
    if (!pd) return;
    setPanels((prev) => prev.map((p) => p.panel.id === panelId ? { ...p, loading: true, error: null } : p));
    try {
      const res = await api.runVisualization(dbId, pd.panel.sql, pd.panel.chart_type, pd.panel.title, pd.panel.config as Record<string, unknown> | undefined);
      setPanels((prev) => prev.map((p) =>
        p.panel.id === panelId ? { ...p, columns: res.columns, rows: res.rows, loading: false } : p
      ));
    } catch (e: any) {
      setPanels((prev) => prev.map((p) =>
        p.panel.id === panelId ? { ...p, loading: false, error: e.message } : p
      ));
    }
  };

  const handleUpdatePin = async (data: {
    title: string; sql: string; chart_type: string;
    config: Record<string, unknown>; columns: string[]; rows: Record<string, unknown>[];
  }) => {
    if (!editingPanel) return;
    try {
      const updated = await api.updateVisualization(editingPanel.id, {
        title: data.title,
        sql: data.sql,
        chart_type: data.chart_type,
        config: data.config,
      });
      setPanels((prev) =>
        prev.map((pd) =>
          pd.panel.id === editingPanel.id
            ? { panel: updated, columns: data.columns, rows: data.rows, loading: false, error: null }
            : pd
        )
      );
      setShowEditor(false);
      setEditingPanel(null);
    } catch {
      // keep editor open
    }
  };

  const loadFromHistory = (entry: VisualizationHistoryEntry) => {
    setEditingPanel(null);
    setHistoryInitial({
      title: entry.title || '',
      sql: entry.sql,
      chart_type: entry.chart_type,
      config: entry.config,
    });
    setShowEditor(true);
    setShowHistory(false);
  };

  const handleClearHistory = async () => {
    await api.clearVisualizationHistory(dbId);
    setHistory([]);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (ms: number | null) => {
    if (ms == null) return '';
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const layout: LayoutItem[] = panels.map((pd) => ({
    i: String(pd.panel.id),
    x: pd.panel.grid_x,
    y: pd.panel.grid_y,
    w: pd.panel.grid_w,
    h: pd.panel.grid_h,
    minW: 2,
    minH: 2,
  }));

  const openNewEditor = () => {
    setEditingPanel(null);
    setHistoryInitial(undefined);
    setShowEditor(true);
  };

  return (
    <div className="viz-dashboard" ref={containerRef}>
      {/* Toolbar */}
      <div className="viz-toolbar">
        <div className="viz-toolbar-left">
          <button className="btn btn-primary" onClick={openNewEditor}>
            + New Visualization
          </button>
          <button
            className={`btn btn-sm${showHistory ? ' btn-history-active' : ''}`}
            onClick={() => setShowHistory(!showHistory)}
          >
            History
          </button>
        </div>
        <div className="viz-toolbar-right">
          <span className="viz-toolbar-info">
            {panels.length} panel{panels.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="query-history-panel viz-history-panel">
          <div className="query-history-header">
            <span className="query-history-title">Visualization History</span>
            {history.length > 0 && (
              <button className="btn-icon" onClick={handleClearHistory} title="Clear history">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <div className="query-history-empty">No visualizations yet</div>
          ) : (
            <div className="query-history-list">
              {history.map((entry) => (
                <button
                  key={entry.id}
                  className="query-history-item"
                  onClick={() => loadFromHistory(entry)}
                >
                  <div className="query-history-item-sql">
                    <span className="viz-history-badge">{entry.chart_type}</span>
                    {entry.title || entry.sql}
                  </div>
                  <div className="query-history-item-meta">
                    <span className={`query-history-status ${entry.status}`}>
                      {entry.status === 'success'
                        ? entry.row_count != null ? `${entry.row_count} rows` : 'OK'
                        : 'Error'}
                    </span>
                    <span>{formatDuration(entry.duration_ms)}</span>
                    <span>{formatTime(entry.created_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Grid */}
      {panels.length > 0 ? (
        <div className="viz-grid-container">
          <Responsive
            className="viz-grid"
            width={containerWidth || 800}
            layouts={{ lg: layout }}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
            rowHeight={80}
            onLayoutChange={handleLayoutChange}
            draggableHandle=".viz-panel-header"
            compactType="vertical"
            margin={[12, 12]}
          >
            {panels.map((pd) => (
              <div key={String(pd.panel.id)} className="viz-panel">
                <div className="viz-panel-header">
                  <span className="viz-panel-title">{pd.panel.title}</span>
                  <div className="viz-panel-actions">
                    <button className="btn-icon" onClick={() => handleRefresh(pd.panel.id)} title="Refresh">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                    </button>
                    <button className="btn-icon" onClick={() => handleEdit(pd.panel)} title="Edit">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button className="btn-icon" onClick={() => handleDelete(pd.panel.id)} title="Remove">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="viz-panel-body">
                  {pd.loading ? (
                    <div className="viz-panel-loading">Loading...</div>
                  ) : pd.error ? (
                    <div className="viz-panel-error">{pd.error}</div>
                  ) : (
                    <ChartRenderer
                      chartType={pd.panel.chart_type as ChartType}
                      columns={pd.columns}
                      rows={pd.rows}
                      config={pd.panel.config}
                    />
                  )}
                </div>
              </div>
            ))}
          </Responsive>
        </div>
      ) : !loadingPanels ? (
        <div className="empty-state">
          <div className="empty-state-icon">{'\u25A8'}</div>
          <div className="empty-state-title">No visualizations yet</div>
          <div className="empty-state-text">
            Create your first visualization by clicking the button above. Write a SQL query,
            choose a chart type, and pin it to your dashboard.
          </div>
          <button className="btn btn-primary" onClick={openNewEditor}>
            + New Visualization
          </button>
        </div>
      ) : (
        <div className="viz-panel-loading" style={{ padding: 40 }}>Loading dashboard...</div>
      )}

      {/* Editor modal */}
      {showEditor && (
        <VisualizationEditor
          key={editingPanel?.id || historyInitial?.sql || 'new'}
          dbId={dbId}
          dbName={dbName}
          onPin={editingPanel ? handleUpdatePin : handlePin}
          onClose={() => { setShowEditor(false); setEditingPanel(null); setHistoryInitial(undefined); }}
          initial={editingPanel ? {
            title: editingPanel.title,
            sql: editingPanel.sql,
            chart_type: editingPanel.chart_type,
            config: editingPanel.config,
          } : historyInitial}
        />
      )}
    </div>
  );
}
