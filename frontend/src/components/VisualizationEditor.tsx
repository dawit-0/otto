import { useState, useCallback } from 'react';
import { api, type VisualizationRunResponse } from '../api';
import ChartRenderer, { CHART_TYPES, type ChartType } from './charts/ChartRenderer';

interface Props {
  dbId: string;
  dbName?: string;
  onPin: (data: {
    title: string; sql: string; chart_type: string;
    config: Record<string, unknown>; columns: string[]; rows: Record<string, unknown>[];
  }) => void;
  onClose: () => void;
  initial?: {
    title?: string;
    sql?: string;
    chart_type?: string;
    config?: Record<string, unknown> | null;
  };
}

export default function VisualizationEditor({ dbId, onPin, onClose, initial }: Props) {
  const [sql, setSql] = useState(initial?.sql || '');
  const [title, setTitle] = useState(initial?.title || '');
  const [chartType, setChartType] = useState<ChartType>((initial?.chart_type as ChartType) || 'bar');
  const [result, setResult] = useState<VisualizationRunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Config state
  const [xColumn, setXColumn] = useState<string>((initial?.config?.xColumn as string) || '');
  const [yColumns, setYColumns] = useState<string[]>((initial?.config?.yColumns as string[]) || []);
  const [statLabel, setStatLabel] = useState<string>((initial?.config?.statLabel as string) || '');
  const [gaugeMin, setGaugeMin] = useState<string>(String(initial?.config?.gaugeMin ?? '0'));
  const [gaugeMax, setGaugeMax] = useState<string>(String(initial?.config?.gaugeMax ?? '100'));

  const buildConfig = useCallback((): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {};
    if (xColumn) cfg.xColumn = xColumn;
    if (yColumns.length > 0) cfg.yColumns = yColumns;
    if (statLabel) cfg.statLabel = statLabel;
    if (chartType === 'gauge') {
      cfg.gaugeMin = Number(gaugeMin) || 0;
      cfg.gaugeMax = Number(gaugeMax) || 100;
    }
    return cfg;
  }, [xColumn, yColumns, statLabel, gaugeMin, gaugeMax, chartType]);

  const run = async () => {
    if (!sql.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.runVisualization(dbId, sql, chartType, title || undefined, buildConfig());
      setResult(res);
      if (!xColumn && res.columns.length > 0) {
        setXColumn(res.columns[0]);
      }
      if (yColumns.length === 0 && res.columns.length > 1) {
        const numeric = res.columns.filter((c) => {
          if (res.rows.length === 0) return false;
          const v = res.rows[0][c];
          return typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)));
        });
        setYColumns(numeric.filter((c) => c !== res.columns[0]).slice(0, 3));
      }
    } catch (e: any) {
      setError(e.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  };

  const handlePin = () => {
    if (!result) return;
    onPin({
      title: title || 'Untitled',
      sql,
      chart_type: chartType,
      config: buildConfig(),
      columns: result.columns,
      rows: result.rows,
    });
  };

  const toggleYColumn = (col: string) => {
    setYColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="viz-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="viz-editor-header">
          <span className="viz-editor-title">
            {initial ? 'Edit Visualization' : 'New Visualization'}
          </span>
          <button className="btn-icon" onClick={onClose} title="Close">&#x2715;</button>
        </div>

        <div className="viz-editor-body">
          {/* Left: SQL + config */}
          <div className="viz-editor-left">
            <div className="viz-editor-field">
              <label>Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="My Visualization"
              />
            </div>

            <div className="viz-editor-field">
              <label>SQL Query</label>
              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="SELECT category, SUM(amount) as total FROM transactions GROUP BY category;"
                spellCheck={false}
              />
            </div>

            <div className="viz-editor-field">
              <label>Chart Type</label>
              <div className="viz-chart-type-grid">
                {CHART_TYPES.map((ct) => (
                  <button
                    key={ct.value}
                    className={`viz-chart-type-btn${chartType === ct.value ? ' active' : ''}`}
                    onClick={() => setChartType(ct.value)}
                  >
                    <span className="viz-chart-type-icon">{ct.icon}</span>
                    <span>{ct.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Column mapping (show after first run) */}
            {result && result.columns.length > 0 && (
              <div className="viz-editor-config">
                <div className="viz-editor-field">
                  <label>X Axis / Label Column</label>
                  <select value={xColumn} onChange={(e) => setXColumn(e.target.value)}>
                    {result.columns.map((col) => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                </div>

                {chartType !== 'stat' && chartType !== 'gauge' && chartType !== 'table' && (
                  <div className="viz-editor-field">
                    <label>Y Axis / Value Columns</label>
                    <div className="viz-column-chips">
                      {result.columns.filter((c) => c !== xColumn).map((col) => (
                        <button
                          key={col}
                          className={`viz-column-chip${yColumns.includes(col) ? ' active' : ''}`}
                          onClick={() => toggleYColumn(col)}
                        >
                          {col}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {(chartType === 'stat' || chartType === 'gauge') && (
                  <div className="viz-editor-field">
                    <label>Display Label</label>
                    <input
                      value={statLabel}
                      onChange={(e) => setStatLabel(e.target.value)}
                      placeholder={yColumns[0] || 'Value'}
                    />
                  </div>
                )}

                {chartType === 'gauge' && (
                  <div className="viz-editor-row">
                    <div className="viz-editor-field">
                      <label>Min</label>
                      <input value={gaugeMin} onChange={(e) => setGaugeMin(e.target.value)} type="number" />
                    </div>
                    <div className="viz-editor-field">
                      <label>Max</label>
                      <input value={gaugeMax} onChange={(e) => setGaugeMax(e.target.value)} type="number" />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="viz-editor-actions">
              <button className="btn btn-primary" onClick={run} disabled={loading || !sql.trim()}>
                {loading ? 'Running...' : 'Run Query'}
              </button>
              {result && (
                <button className="btn btn-primary" onClick={handlePin}>
                  Pin to Dashboard
                </button>
              )}
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Cmd+Enter to run</span>
            </div>

            {error && <div className="viz-editor-error">{error}</div>}
          </div>

          {/* Right: Preview */}
          <div className="viz-editor-right">
            {result ? (
              <div className="viz-editor-preview">
                <div className="viz-editor-preview-header">
                  <span>{title || 'Preview'}</span>
                  <span className="viz-editor-preview-meta">
                    {result.row_count} row{result.row_count !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="viz-editor-preview-chart">
                  <ChartRenderer
                    chartType={chartType}
                    columns={result.columns}
                    rows={result.rows}
                    config={buildConfig()}
                  />
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">{'\u25A8'}</div>
                <div className="empty-state-title">Preview</div>
                <div className="empty-state-text">
                  Write a SQL query and click Run to preview your visualization.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
