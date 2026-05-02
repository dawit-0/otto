import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type QueryResponse, type QueryHistoryEntry, type SavedQueryEntry, type TableInfo } from '../api';
import DataTable from './DataTable';
import QueryInsights from './QueryInsights';
import SqlAutocomplete from './SqlAutocomplete';
import { getCompletionContext, getSuggestions, getCaretViewportCoords } from '../utils/sqlAutocomplete';
import type { Suggestion } from '../utils/sqlAutocomplete';
import { type ChartType } from './charts/ChartRenderer';

const MAX_SUGGESTIONS = 12;

interface Props {
  dbId: string;
  dbName: string;
  tables: TableInfo[];
  onVisualize?: (sql: string, chartType: ChartType, xColumn: string, yColumns: string[]) => void;
}

export default function QueryEditor({ dbId, dbName, tables, onVisualize }: Props) {
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const [showAiInput, setShowAiInput] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Saved queries state
  const [showSaved, setShowSaved] = useState(false);
  const [savedQueries, setSavedQueries] = useState<SavedQueryEntry[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [editingQuery, setEditingQuery] = useState<SavedQueryEntry | null>(null);

  // Autocomplete state
  const [acSuggestions, setAcSuggestions] = useState<Suggestion[]>([]);
  const [acIndex, setAcIndex] = useState(0);
  const [acStyle, setAcStyle] = useState<React.CSSProperties>({});
  const [acVisible, setAcVisible] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const fetchSavedQueries = useCallback(async () => {
    try {
      const entries = await api.listSavedQueries(dbId);
      setSavedQueries(entries);
    } catch {
      // non-critical
    }
  }, [dbId]);

  useEffect(() => {
    if (showSaved) fetchSavedQueries();
  }, [showSaved, fetchSavedQueries]);

  // Reset autocomplete when db changes
  useEffect(() => {
    setAcVisible(false);
  }, [dbId]);

  const updateAutocomplete = useCallback(
    (text: string, cursorPos: number, textarea: HTMLTextAreaElement) => {
      if (tables.length === 0) {
        setAcVisible(false);
        return;
      }

      const ctx = getCompletionContext(text, cursorPos);
      if (!ctx.kind) {
        setAcVisible(false);
        return;
      }

      const suggestions = getSuggestions(ctx, tables).slice(0, MAX_SUGGESTIONS);
      if (suggestions.length === 0) {
        setAcVisible(false);
        return;
      }

      const { top, left } = getCaretViewportCoords(textarea, cursorPos);

      // Flip above if there isn't room below
      const dropdownHeight = Math.min(suggestions.length, MAX_SUGGESTIONS) * 30 + 8;
      const flipUp = top + dropdownHeight > window.innerHeight - 8;

      setAcSuggestions(suggestions);
      setAcIndex(0);
      setAcStyle(
        flipUp
          ? { position: 'fixed', bottom: window.innerHeight - top + 24, left, maxHeight: 300 }
          : { position: 'fixed', top, left, maxHeight: 300 },
      );
      setAcVisible(true);
    },
    [tables],
  );

  const applyCompletion = useCallback(
    (suggestion: Suggestion) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const pos = textarea.selectionStart ?? sql.length;
      const before = sql.slice(0, pos);
      const tokenMatch = before.match(/[\w.]*$/);
      const token = tokenMatch ? tokenMatch[0] : '';
      const tokenStart = pos - token.length;

      // For qualified completions (users.na → users.name), replace only the part after dot
      const dotIdx = token.indexOf('.');
      const insertStart = dotIdx !== -1 ? tokenStart + dotIdx + 1 : tokenStart;

      const insertText = suggestion.label;
      const newSql = sql.slice(0, insertStart) + insertText + sql.slice(pos);
      setSql(newSql);
      setAcVisible(false);

      const newPos = insertStart + insertText.length;
      setTimeout(() => {
        if (textarea) {
          textarea.setSelectionRange(newPos, newPos);
          textarea.focus();
        }
      }, 0);
    },
    [sql],
  );

  const handleSqlChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setSql(val);
    const pos = e.target.selectionStart ?? val.length;
    updateAutocomplete(val, pos, e.target);
  };

  const handleSaveQuery = async () => {
    if (!saveName.trim() || !sql.trim()) return;
    try {
      if (editingQuery) {
        const updated = await api.updateSavedQuery(editingQuery.id, {
          name: saveName,
          sql,
          description: saveDescription || undefined,
        });
        setSavedQueries((prev) => prev.map((q) => q.id === updated.id ? updated : q));
      } else {
        const saved = await api.saveQuery({
          db_id: dbId,
          db_name: dbName,
          name: saveName,
          sql,
          description: saveDescription || undefined,
        });
        setSavedQueries((prev) => [saved, ...prev]);
      }
      setShowSaveModal(false);
      setSaveName('');
      setSaveDescription('');
      setEditingQuery(null);
    } catch {
      // keep modal open on error
    }
  };

  const handleDeleteSavedQuery = async (id: number) => {
    await api.deleteSavedQuery(id);
    setSavedQueries((prev) => prev.filter((q) => q.id !== id));
  };

  const loadFromSaved = (entry: SavedQueryEntry) => {
    setSql(entry.sql);
    setShowSaved(false);
  };

  const openSaveModal = (existing?: SavedQueryEntry) => {
    if (existing) {
      setEditingQuery(existing);
      setSaveName(existing.name);
      setSaveDescription(existing.description || '');
    } else {
      setEditingQuery(null);
      setSaveName('');
      setSaveDescription('');
    }
    setShowSaveModal(true);
  };

  const run = async () => {
    if (!sql.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.executeQuery(dbId, sql);
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Query failed');
      setResult(null);
    } finally {
      setLoading(false);
      if (showHistory) fetchHistory();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (acVisible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAcIndex((i) => Math.min(i + 1, acSuggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAcIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.metaKey && !e.ctrlKey)) {
        if (acSuggestions[acIndex]) {
          e.preventDefault();
          applyCompletion(acSuggestions[acIndex]);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAcVisible(false);
        return;
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  };

  const handleTextareaClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const pos = ta.selectionStart ?? sql.length;
    updateAutocomplete(sql, pos, ta);
  };

  const handleTextareaBlur = () => {
    // Delay so click on suggestion fires first
    setTimeout(() => setAcVisible(false), 120);
  };

  const loadFromHistory = (entry: QueryHistoryEntry) => {
    setSql(entry.sql);
    setShowHistory(false);
  };

  const generateWithAi = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await api.generateAiQuery(dbId, aiPrompt);
      setSql(res.sql);
      setAiPrompt('');
      setShowAiInput(false);
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      generateWithAi();
    }
    if (e.key === 'Escape') {
      setShowAiInput(false);
    }
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
        <div style={{ position: 'relative' }}>
          <textarea
            ref={textareaRef}
            value={sql}
            onChange={handleSqlChange}
            onKeyDown={handleKeyDown}
            onClick={handleTextareaClick}
            onBlur={handleTextareaBlur}
            placeholder="SELECT * FROM table_name LIMIT 100;"
            spellCheck={false}
          />
          {acVisible && (
            <SqlAutocomplete
              suggestions={acSuggestions}
              activeIndex={acIndex}
              style={acStyle}
              onSelect={applyCompletion}
            />
          )}
        </div>
        <div className="query-editor-actions">
          <button className="btn btn-primary" onClick={run} disabled={loading || !sql.trim()}>
            {loading ? 'Running...' : 'Run Query'}
          </button>
          <button
            className={`btn btn-ai${showAiInput ? ' btn-ai-active' : ''}`}
            onClick={() => setShowAiInput(!showAiInput)}
          >
            Ask with AI
          </button>
          <button
            className="btn btn-sm"
            onClick={() => openSaveModal()}
            disabled={!sql.trim()}
            title="Save current query"
          >
            Save
          </button>
          <button
            className={`btn btn-sm${showSaved ? ' btn-history-active' : ''}`}
            onClick={() => { setShowSaved(!showSaved); if (showHistory) setShowHistory(false); }}
          >
            Saved
          </button>
          <button
            className={`btn btn-sm${showHistory ? ' btn-history-active' : ''}`}
            onClick={() => { setShowHistory(!showHistory); if (showSaved) setShowSaved(false); }}
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

      {showAiInput && (
        <div className="ai-input-panel">
          <div className="ai-input-row">
            <input
              className="ai-input"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={handleAiKeyDown}
              placeholder="Describe the query you want in plain English..."
              autoFocus
              disabled={aiLoading}
            />
            <button
              className="btn btn-primary btn-ai-generate"
              onClick={generateWithAi}
              disabled={aiLoading || !aiPrompt.trim()}
            >
              {aiLoading ? 'Generating...' : 'Generate'}
            </button>
          </div>
          {aiError && <div className="ai-error">{aiError}</div>}
        </div>
      )}

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

      {showSaved && (
        <div className="query-history-panel">
          <div className="query-history-header">
            <span className="query-history-title">Saved Queries</span>
          </div>
          {savedQueries.length === 0 ? (
            <div className="query-history-empty">No saved queries yet</div>
          ) : (
            <div className="query-history-list">
              {savedQueries.map((entry) => (
                <div key={entry.id} className="saved-query-item">
                  <button
                    className="query-history-item saved-query-item-btn"
                    onClick={() => loadFromSaved(entry)}
                  >
                    <div className="saved-query-item-name">{entry.name}</div>
                    {entry.description && (
                      <div className="saved-query-item-desc">{entry.description}</div>
                    )}
                    <div className="query-history-item-sql">{entry.sql}</div>
                  </button>
                  <div className="saved-query-item-actions">
                    <button
                      className="btn-icon"
                      onClick={() => { setSql(entry.sql); openSaveModal(entry); }}
                      title="Edit"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      className="btn-icon"
                      onClick={() => handleDeleteSavedQuery(entry.id)}
                      title="Delete"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{editingQuery ? 'Update Saved Query' : 'Save Query'}</div>
            <div className="modal-field">
              <label>Name</label>
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="My useful query"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveQuery(); if (e.key === 'Escape') setShowSaveModal(false); }}
              />
            </div>
            <div className="modal-field">
              <label>Description (optional)</label>
              <input
                value={saveDescription}
                onChange={(e) => setSaveDescription(e.target.value)}
                placeholder="What does this query do?"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveQuery(); if (e.key === 'Escape') setShowSaveModal(false); }}
              />
            </div>
            <div className="saved-query-preview">
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>SQL</label>
              <pre className="saved-query-preview-sql">{sql}</pre>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowSaveModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveQuery} disabled={!saveName.trim()}>
                {editingQuery ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {result && result.columns.length > 0 && (
        <>
          <QueryInsights
            columns={result.columns}
            rows={result.rows}
            onVisualize={(chartType, xColumn, yColumns) => {
              if (onVisualize) onVisualize(sql, chartType, xColumn, yColumns);
            }}
          />
          <DataTable columns={result.columns} rows={result.rows} exportFilename="query-results" />
        </>
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
