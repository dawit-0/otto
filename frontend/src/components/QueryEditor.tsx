import { useState, useEffect, useCallback } from 'react';
import { api, type QueryResponse, type QueryHistoryEntry } from '../api';
import DataTable from './DataTable';

interface Props {
  dbId: string;
}

export default function QueryEditor({ dbId }: Props) {
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);

  const fetchHistory = useCallback(async () => {
    try {
      const entries = await api.getQueryHistory(dbId);
      setHistory(entries);
    } catch {
      // silently fail — history is non-critical
    }
  }, [dbId]);

  useEffect(() => {
    if (showHistory) fetchHistory();
  }, [showHistory, fetchHistory]);

  const run = async () => {
    if (!sql.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.executeQuery(dbId, sql);
      setResult(res);
    } catch (e: any) {
      setError(e.message);
      setResult(null);
    } finally {
      setLoading(false);
      if (showHistory) fetchHistory();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  };

  const loadFromHistory = (entry: QueryHistoryEntry) => {
    setSql(entry.sql);
    setShowHistory(false);
  };

  const handleClearHistory = async () => {
    await api.clearHistory(dbId);
    setHistory([]);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (ms: number | null) => {
    if (ms == null) return '';
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <div className="query-panel">
      <div className="query-editor">
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="SELECT * FROM table_name LIMIT 100;"
          spellCheck={false}
        />
        <div className="query-editor-actions">
          <button className="btn btn-primary" onClick={run} disabled={loading || !sql.trim()}>
            {loading ? 'Running...' : 'Run Query'}
          </button>
          <button
            className={`btn btn-sm${showHistory ? ' btn-history-active' : ''}`}
            onClick={() => setShowHistory(!showHistory)}
          >
            History
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Cmd+Enter to execute</span>
          {error && <span className="query-status error">{error}</span>}
          {result && !error && (
            <span className="query-status success">
              {result.message || `${result.row_count} row${result.row_count !== 1 ? 's' : ''} returned`}
            </span>
          )}
        </div>
      </div>

      {showHistory && (
        <div className="query-history-panel">
          <div className="query-history-header">
            <span className="query-history-title">Query History</span>
            {history.length > 0 && (
              <button className="btn-icon" onClick={handleClearHistory} title="Clear history">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <div className="query-history-empty">No queries yet</div>
          ) : (
            <div className="query-history-list">
              {history.map((entry) => (
                <button
                  key={entry.id}
                  className="query-history-item"
                  onClick={() => loadFromHistory(entry)}
                >
                  <div className="query-history-item-sql">{entry.sql}</div>
                  <div className="query-history-item-meta">
                    <span className={`query-history-status ${entry.status}`}>
                      {entry.status === 'success' ? (
                        entry.row_count != null ? `${entry.row_count} rows` : 'OK'
                      ) : (
                        'Error'
                      )}
                    </span>
                    <span>{formatDuration(entry.duration_ms)}</span>
                    <span>{formatTime(entry.executed_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {result && result.columns.length > 0 && (
        <DataTable columns={result.columns} rows={result.rows} />
      )}
      {result && result.columns.length === 0 && !error && (
        <div className="empty-state">
          <div className="empty-state-title">Query executed</div>
          <div className="empty-state-text">{result.message || 'No rows returned.'}</div>
        </div>
      )}
      {!result && !error && !showHistory && (
        <div className="empty-state">
          <div className="empty-state-icon">{'>'}_</div>
          <div className="empty-state-title">SQL Query Editor</div>
          <div className="empty-state-text">
            Write a query above and press Run or Cmd+Enter to execute it against the selected database.
          </div>
        </div>
      )}
    </div>
  );
}
