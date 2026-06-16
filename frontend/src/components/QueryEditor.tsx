import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type QueryResponse, type QueryHistoryEntry, type SavedQueryEntry, type QueryParam, type ExplainPlanResponse } from '../api';
import DataTable from './DataTable';
import QueryInsights from './QueryInsights';
import QueryPlan from './QueryPlan';
import SQLEditor from './SQLEditor';
import { type ChartType } from './charts/ChartRenderer';

interface Props {
  dbId: string;
  dbName: string;
  dbType?: 'sqlite' | 'postgres';
  initialSql?: string;
  onVisualize?: (sql: string, chartType: ChartType, xColumn: string, yColumns: string[]) => void;
}

interface QueryTab {
  id: string;
  sql: string;
  result: QueryResponse | null;
  error: string | null;
  loading: boolean;
  plan: ExplainPlanResponse | null;
  planLoading: boolean;
  planError: string | null;
}

function makeTab(sql = ''): QueryTab {
  return {
    id: Math.random().toString(36).slice(2, 9),
    sql,
    result: null,
    error: null,
    loading: false,
    plan: null,
    planLoading: false,
    planError: null,
  };
}

function tabLabel(tab: QueryTab, index: number): string {
  const s = tab.sql.trim();
  if (!s) return `Query ${index + 1}`;
  const match = s.match(/(?:from|join|update|into)\s+[`"[]?(\w+)/i);
  if (match) return match[1];
  const firstWord = s.split(/\s+/)[0];
  return firstWord.length > 12 ? firstWord.slice(0, 12) : firstWord || `Query ${index + 1}`;
}

function storageKey(dbId: string) { return `otto-tabs-${dbId}`; }

function loadTabs(dbId: string): { tabs: Pick<QueryTab, 'id' | 'sql'>[]; activeId: string } | null {
  try {
    const raw = localStorage.getItem(storageKey(dbId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveTabs(dbId: string, tabs: QueryTab[], activeId: string) {
  try {
    localStorage.setItem(storageKey(dbId), JSON.stringify({
      tabs: tabs.map(({ id, sql }) => ({ id, sql })),
      activeId,
    }));
  } catch { /* ignore */ }
}

function detectParams(sql: string): string[] {
  const matches = [...sql.matchAll(/\{\{(\w+)\}\}/g)];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const m of matches) {
    if (!seen.has(m[1])) { seen.add(m[1]); unique.push(m[1]); }
  }
  return unique;
}

export default function QueryEditor({ dbId, dbName, dbType, initialSql, onVisualize }: Props) {
  // ── Tabs ──
  const initState = useCallback((): { tabs: QueryTab[]; activeId: string } => {
    const stored = loadTabs(dbId);
    if (stored && stored.tabs.length > 0) {
      const tabs = stored.tabs.map(({ id, sql }) => makeTab(sql.length > 0 ? sql : ''));
      // Fix ids to match stored
      stored.tabs.forEach((s, i) => { tabs[i].id = s.id; });
      return { tabs, activeId: stored.activeId };
    }
    const first = makeTab(initialSql ?? '');
    return { tabs: [first], activeId: first.id };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [tabs, setTabs] = useState<QueryTab[]>(() => initState().tabs);
  const [activeTabId, setActiveTabId] = useState<string>(() => initState().activeId);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const updateTab = useCallback((id: string, updates: Partial<QueryTab>) => {
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, ...updates } : t));
  }, []);

  // Persist tabs whenever they change
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeTabId);
  activeIdRef.current = activeTabId;

  useEffect(() => {
    saveTabs(dbId, tabs, activeTabId);
  }, [dbId, tabs, activeTabId]);

  // If initialSql changes (e.g. loaded from Ask Otto), put it in the active tab
  const prevInitialSql = useRef(initialSql);
  useEffect(() => {
    if (initialSql && initialSql !== prevInitialSql.current) {
      prevInitialSql.current = initialSql;
      updateTab(activeIdRef.current, { sql: initialSql, result: null, error: null, plan: null });
    }
  }, [initialSql, updateTab]);

  const addTab = useCallback(() => {
    const tab = makeTab('');
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      if (prev.length === 1) return prev;
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (activeIdRef.current === id) {
        const newActive = next[Math.max(0, idx - 1)];
        setActiveTabId(newActive.id);
      }
      return next;
    });
  }, []);

  // ── Schema ──
  const [schema, setSchema] = useState<Record<string, string[]>>({});

  useEffect(() => {
    api.getSchema(dbId).then((res) => {
      const s: Record<string, string[]> = {};
      for (const table of res.tables) s[table.name] = table.columns.map((c) => c.name);
      setSchema(s);
    }).catch(() => {});
  }, [dbId]);

  // ── History ──
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);

  const fetchHistory = useCallback(async () => {
    try { setHistory(await api.getQueryHistory(dbId)); } catch { /* non-critical */ }
  }, [dbId]);

  useEffect(() => { if (showHistory) fetchHistory(); }, [showHistory, fetchHistory]);

  // ── Saved queries ──
  const [showSaved, setShowSaved] = useState(false);
  const [savedQueries, setSavedQueries] = useState<SavedQueryEntry[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saveParams, setSaveParams] = useState<QueryParam[]>([]);
  const [editingQuery, setEditingQuery] = useState<SavedQueryEntry | null>(null);

  const fetchSavedQueries = useCallback(async () => {
    try { setSavedQueries(await api.listSavedQueries(dbId)); } catch { /* non-critical */ }
  }, [dbId]);

  useEffect(() => { if (showSaved) fetchSavedQueries(); }, [showSaved, fetchSavedQueries]);

  // ── Parameter run modal ──
  const [runTarget, setRunTarget] = useState<SavedQueryEntry | null>(null);
  const [runValues, setRunValues] = useState<Record<string, string>>({});
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  // ── AI ──
  const [showAiInput, setShowAiInput] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // ── Handlers ──
  const sql = activeTab.sql;
  const result = activeTab.result;
  const error = activeTab.error;
  const loading = activeTab.loading;
  const plan = activeTab.plan;
  const planLoading = activeTab.planLoading;
  const planError = activeTab.planError;
  const tabId = activeTab.id;

  const handleSqlChange = (newSql: string) => {
    updateTab(tabId, { sql: newSql });
    if (showSaveModal && !editingQuery) {
      const detected = detectParams(newSql);
      setSaveParams((prev) => {
        const existing = new Map(prev.map((p) => [p.name, p]));
        return detected.map((name) => existing.get(name) ?? {
          name,
          label: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          type: 'text' as const,
          default_value: '',
        });
      });
    }
  };

  const run = async () => {
    if (!sql.trim()) return;
    updateTab(tabId, { loading: true, error: null, plan: null, planError: null });
    try {
      const res = await api.executeQuery(dbId, sql);
      updateTab(tabId, { result: res, loading: false });
    } catch (e: any) {
      updateTab(tabId, { error: e.message, result: null, loading: false });
    }
    if (showHistory) fetchHistory();
  };

  const explain = async () => {
    if (!sql.trim()) return;
    updateTab(tabId, { planLoading: true, planError: null });
    try {
      const res = await api.explainQuery(dbId, sql);
      updateTab(tabId, { plan: res, planLoading: false });
    } catch (e: any) {
      updateTab(tabId, { planError: e.message, plan: null, planLoading: false });
    }
  };

  const loadFromHistory = (entry: QueryHistoryEntry) => {
    updateTab(tabId, { sql: entry.sql });
    setShowHistory(false);
  };

  const loadFromSaved = (entry: SavedQueryEntry) => {
    updateTab(tabId, { sql: entry.sql });
    setShowSaved(false);
  };

  const openRunModal = (entry: SavedQueryEntry) => {
    setRunTarget(entry);
    const defaults: Record<string, string> = {};
    for (const p of entry.parameters) defaults[p.name] = p.default_value;
    setRunValues(defaults);
    setRunError(null);
  };

  const handleRunWithParams = async () => {
    if (!runTarget) return;
    setRunLoading(true);
    setRunError(null);
    try {
      const res = await api.runSavedQuery(runTarget.id, dbId, runValues);
      updateTab(tabId, { result: res, error: null });
      setRunTarget(null);
      setShowSaved(false);
    } catch (e: any) {
      setRunError(e.message);
    } finally {
      setRunLoading(false);
    }
  };

  const generateWithAi = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await api.generateAiQuery(dbId, aiPrompt);
      updateTab(tabId, { sql: res.sql });
      setAiPrompt('');
      setShowAiInput(false);
    } catch (e: any) {
      setAiError(e.message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generateWithAi(); }
    if (e.key === 'Escape') setShowAiInput(false);
  };

  const handleClearHistory = async () => {
    await api.clearHistory(dbId);
    setHistory([]);
  };

  const openSaveModal = (existing?: SavedQueryEntry) => {
    if (existing) {
      setEditingQuery(existing);
      setSaveName(existing.name);
      setSaveDescription(existing.description || '');
      setSaveParams(existing.parameters ?? []);
    } else {
      setEditingQuery(null);
      setSaveName('');
      setSaveDescription('');
      const detected = detectParams(sql);
      setSaveParams(detected.map((name) => ({
        name,
        label: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        type: 'text' as const,
        default_value: '',
      })));
    }
    setShowSaveModal(true);
  };

  const handleSaveQuery = async () => {
    if (!saveName.trim() || !sql.trim()) return;
    try {
      if (editingQuery) {
        const updated = await api.updateSavedQuery(editingQuery.id, {
          name: saveName, sql, description: saveDescription || undefined, parameters: saveParams,
        });
        setSavedQueries((prev) => prev.map((q) => q.id === updated.id ? updated : q));
      } else {
        const saved = await api.saveQuery({
          db_id: dbId, db_name: dbName, name: saveName, sql,
          description: saveDescription || undefined, parameters: saveParams,
        });
        setSavedQueries((prev) => [saved, ...prev]);
      }
      setShowSaveModal(false);
      setSaveName('');
      setSaveDescription('');
      setSaveParams([]);
      setEditingQuery(null);
    } catch { /* keep modal open on error */ }
  };

  const handleDeleteSavedQuery = async (id: number) => {
    await api.deleteSavedQuery(id);
    setSavedQueries((prev) => prev.filter((q) => q.id !== id));
  };

  const updateSaveParam = (index: number, field: keyof QueryParam, value: string) => {
    setSaveParams((prev) => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
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

  const detectedParamNames = detectParams(sql);
  const hasTemplateParams = detectedParamNames.length > 0;

  return (
    <div className="query-panel">
      {/* ── Tab Bar ── */}
      <div className="query-tab-bar">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            className={`query-tab${tab.id === activeTabId ? ' active' : ''}`}
            onClick={() => setActiveTabId(tab.id)}
            title={tab.sql || `Query ${i + 1}`}
          >
            <span className="query-tab-name">{tabLabel(tab, i)}</span>
            {tabs.length > 1 && (
              <span
                className="query-tab-close"
                role="button"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              >
                ×
              </span>
            )}
          </button>
        ))}
        <button className="query-tab-add" onClick={addTab} title="New query tab">
          +
        </button>
      </div>

      {/* ── Editor ── */}
      <div className="query-editor">
        <SQLEditor
          value={sql}
          onChange={handleSqlChange}
          onExecute={run}
          schema={schema}
          dialect={dbType}
          placeholder="SELECT * FROM table_name LIMIT 100;"
        />
        {hasTemplateParams && (
          <div className="param-badges">
            <span className="param-badges-label">Parameters:</span>
            {detectedParamNames.map((name) => (
              <span key={name} className="param-badge">{`{{${name}}}`}</span>
            ))}
          </div>
        )}
        <div className="query-editor-actions">
          <button className="btn btn-primary" onClick={run} disabled={loading || !sql.trim()}>
            {loading ? 'Running...' : 'Run Query'}
          </button>
          <button
            className="btn"
            onClick={explain}
            disabled={planLoading || !sql.trim()}
            title="Run EXPLAIN ANALYZE (PostgreSQL) / EXPLAIN QUERY PLAN (SQLite) on this query"
          >
            {planLoading ? 'Explaining...' : 'Explain Analyze'}
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
          {planError && <span className="query-status error">{planError}</span>}
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
                <button key={entry.id} className="query-history-item" onClick={() => loadFromHistory(entry)}>
                  <div className="query-history-item-sql">{entry.sql}</div>
                  <div className="query-history-item-meta">
                    <span className={`query-history-status ${entry.status}`}>
                      {entry.status === 'success' ? (entry.row_count != null ? `${entry.row_count} rows` : 'OK') : 'Error'}
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
                    <div className="saved-query-item-name">
                      {entry.name}
                      {entry.parameters.length > 0 && (
                        <span className="saved-query-param-count" title={`${entry.parameters.length} parameter${entry.parameters.length !== 1 ? 's' : ''}`}>
                          {entry.parameters.length}
                        </span>
                      )}
                    </div>
                    {entry.description && (
                      <div className="saved-query-item-desc">{entry.description}</div>
                    )}
                    <div className="query-history-item-sql">{entry.sql}</div>
                  </button>
                  <div className="saved-query-item-actions">
                    {entry.parameters.length > 0 && (
                      <button
                        className="btn-icon btn-icon-run"
                        onClick={() => openRunModal(entry)}
                        title="Run with parameters"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      </button>
                    )}
                    <button
                      className="btn-icon"
                      onClick={() => { updateTab(tabId, { sql: entry.sql }); openSaveModal(entry); }}
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

      {/* ── Save / Edit Query Modal ── */}
      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{editingQuery ? 'Update Saved Query' : 'Save Query'}</div>
            <div className="modal-field">
              <label>Name</label>
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="My useful query"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Escape') setShowSaveModal(false); }}
              />
            </div>
            <div className="modal-field">
              <label>Description (optional)</label>
              <input
                value={saveDescription}
                onChange={(e) => setSaveDescription(e.target.value)}
                placeholder="What does this query do?"
                onKeyDown={(e) => { if (e.key === 'Escape') setShowSaveModal(false); }}
              />
            </div>
            <div className="saved-query-preview">
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>SQL</label>
              <pre className="saved-query-preview-sql">{sql}</pre>
            </div>

            {saveParams.length > 0 && (
              <div className="modal-params-section">
                <div className="modal-params-header">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
                    <circle cx="12" cy="12" r="3" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M4.93 4.93a10 10 0 0 0 0 14.14" />
                  </svg>
                  <span>Template Parameters</span>
                </div>
                <p className="modal-params-hint">
                  These <code>{`{{placeholders}}`}</code> were detected in your SQL. Customize the labels and types shown in the run dialog.
                </p>
                <div className="modal-params-list">
                  {saveParams.map((param, i) => (
                    <div key={param.name} className="modal-param-row">
                      <span className="modal-param-name">{`{{${param.name}}}`}</span>
                      <input
                        className="modal-param-label-input"
                        value={param.label}
                        onChange={(e) => updateSaveParam(i, 'label', e.target.value)}
                        placeholder="Label"
                      />
                      <select
                        className="modal-param-type-select"
                        value={param.type}
                        onChange={(e) => updateSaveParam(i, 'type', e.target.value)}
                      >
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                        <option value="date">Date</option>
                      </select>
                      <input
                        className="modal-param-default-input"
                        value={param.default_value}
                        onChange={(e) => updateSaveParam(i, 'default_value', e.target.value)}
                        placeholder="Default value"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn" onClick={() => setShowSaveModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveQuery} disabled={!saveName.trim()}>
                {editingQuery ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Run with Parameters Modal ── */}
      {runTarget && (
        <div className="modal-overlay" onClick={() => setRunTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Run: {runTarget.name}</div>
            {runTarget.description && (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>{runTarget.description}</p>
            )}
            <div className="run-params-list">
              {runTarget.parameters.map((param) => (
                <div key={param.name} className="modal-field">
                  <label>{param.label || param.name}</label>
                  <input
                    type={param.type === 'number' ? 'number' : param.type === 'date' ? 'date' : 'text'}
                    value={runValues[param.name] ?? param.default_value}
                    onChange={(e) => setRunValues((prev) => ({ ...prev, [param.name]: e.target.value }))}
                    placeholder={param.default_value || `Enter ${param.label || param.name}`}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRunWithParams(); if (e.key === 'Escape') setRunTarget(null); }}
                    autoFocus={runTarget.parameters[0]?.name === param.name}
                  />
                </div>
              ))}
            </div>
            <div className="run-params-sql-preview">
              <span className="run-params-sql-label">SQL template</span>
              <pre className="saved-query-preview-sql">{runTarget.sql}</pre>
            </div>
            {runError && <div className="ai-error" style={{ marginBottom: 12 }}>{runError}</div>}
            <div className="modal-actions">
              <button className="btn" onClick={() => setRunTarget(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleRunWithParams} disabled={runLoading}>
                {runLoading ? 'Running...' : 'Run Query'}
              </button>
            </div>
          </div>
        </div>
      )}

      {plan && <QueryPlan plan={plan} dbType={dbType} />}

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
            Use <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: 4 }}>{`{{param_name}}`}</code> to create reusable templates.
          </div>
        </div>
      )}
    </div>
  );
}
