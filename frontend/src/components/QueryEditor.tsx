import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type QueryResponse, type QueryHistoryEntry, type SavedQueryEntry, type TableInfo } from '../api';
import DataTable from './DataTable';
import QueryInsights from './QueryInsights';
import { type ChartType } from './charts/ChartRenderer';

// ─── Autocomplete engine ───────────────────────────────────────────────────

const SQL_KEYWORDS = [
  'SELECT', 'DISTINCT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN',
  'INNER JOIN', 'CROSS JOIN', 'ON', 'ORDER BY', 'GROUP BY', 'HAVING',
  'LIMIT', 'OFFSET', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
  'AS', 'AND', 'OR', 'NOT', 'IN', 'NOT IN', 'LIKE', 'BETWEEN',
  'IS NULL', 'IS NOT NULL', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'COALESCE', 'NULLIF', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT',
  'WITH', 'EXPLAIN', 'PRAGMA', 'CREATE TABLE', 'DROP TABLE', 'ALTER TABLE',
];

const TABLE_CONTEXTS = new Set([
  'FROM', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'CROSS JOIN',
  'INTO', 'UPDATE', 'TABLE',
]);

const COLUMN_CONTEXTS = new Set([
  'SELECT', 'WHERE', 'ON', 'SET', 'HAVING', 'ORDER BY', 'GROUP BY', 'BY', 'DISTINCT',
]);

type SuggestionKind = 'keyword' | 'table' | 'column';

interface Suggestion {
  kind: SuggestionKind;
  label: string;
  detail?: string;
  insert: string;
}

function getLastSqlContext(textBeforeWord: string): string {
  const upper = textBeforeWord.toUpperCase().replace(/\s+/g, ' ');
  const keywords = [
    'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'CROSS JOIN',
    'ORDER BY', 'GROUP BY', 'INSERT INTO', 'DELETE FROM',
    'IS NOT NULL', 'NOT IN', 'UNION ALL',
    'SELECT', 'DISTINCT', 'FROM', 'WHERE', 'JOIN', 'INTO', 'UPDATE',
    'ON', 'SET', 'HAVING', 'TABLE',
  ];
  let lastPos = -1;
  let lastKw = '';
  for (const kw of keywords) {
    const re = new RegExp(`\\b${kw.replace(' ', '\\s+')}\\b`, 'g');
    let m;
    while ((m = re.exec(upper)) !== null) {
      if (m.index > lastPos) {
        lastPos = m.index;
        lastKw = kw;
      }
    }
  }
  return lastKw;
}

function isInsideString(textBefore: string): boolean {
  let count = 0;
  for (let i = 0; i < textBefore.length; i++) {
    if (textBefore[i] === "'") {
      if (textBefore[i + 1] === "'") { i++; } else { count++; }
    }
  }
  return count % 2 === 1;
}

function computeSuggestions(sql: string, cursor: number, tables: TableInfo[]): { suggestions: Suggestion[]; word: string } {
  const textBefore = sql.slice(0, cursor);

  if (isInsideString(textBefore)) return { suggestions: [], word: '' };

  const wordMatch = textBefore.match(/[\w.]+$/);
  if (!wordMatch || wordMatch[0].length === 0) return { suggestions: [], word: '' };
  const word = wordMatch[0];

  // Dot notation: table.col prefix
  if (word.includes('.')) {
    const dotIdx = word.lastIndexOf('.');
    const tablePrefix = word.slice(0, dotIdx);
    const colPrefix = word.slice(dotIdx + 1).toLowerCase();
    const table = tables.find(t => t.name.toLowerCase() === tablePrefix.toLowerCase());
    if (!table) return { suggestions: [], word };
    const suggestions = table.columns
      .filter(c => c.name.toLowerCase().startsWith(colPrefix))
      .map(c => ({
        kind: 'column' as SuggestionKind,
        label: c.name,
        detail: c.type || '',
        insert: `${tablePrefix}.${c.name}`,
      }))
      .slice(0, 8);
    return { suggestions, word };
  }

  const lower = word.toLowerCase();
  const textBeforeWord = textBefore.slice(0, textBefore.length - word.length);
  const context = getLastSqlContext(textBeforeWord);

  const results: Suggestion[] = [];

  if (TABLE_CONTEXTS.has(context)) {
    tables.forEach(t => {
      if (t.name.toLowerCase().startsWith(lower))
        results.push({ kind: 'table', label: t.name, detail: `${t.row_count} rows`, insert: t.name });
    });
    tables.forEach(t =>
      t.columns.forEach(c => {
        if (c.name.toLowerCase().startsWith(lower))
          results.push({ kind: 'column', label: c.name, detail: t.name, insert: c.name });
      })
    );
  } else if (COLUMN_CONTEXTS.has(context)) {
    tables.forEach(t =>
      t.columns.forEach(c => {
        if (c.name.toLowerCase().startsWith(lower))
          results.push({ kind: 'column', label: c.name, detail: t.name, insert: c.name });
      })
    );
    tables.forEach(t => {
      if (t.name.toLowerCase().startsWith(lower))
        results.push({ kind: 'table', label: t.name, detail: `${t.row_count} rows`, insert: t.name });
    });
  } else {
    SQL_KEYWORDS.forEach(kw => {
      if (kw.toLowerCase().startsWith(lower))
        results.push({ kind: 'keyword', label: kw, insert: kw });
    });
    tables.forEach(t => {
      if (t.name.toLowerCase().startsWith(lower))
        results.push({ kind: 'table', label: t.name, detail: `${t.row_count} rows`, insert: t.name });
    });
    tables.forEach(t =>
      t.columns.forEach(c => {
        if (c.name.toLowerCase().startsWith(lower))
          results.push({ kind: 'column', label: c.name, detail: t.name, insert: c.name });
      })
    );
  }

  const seen = new Set<string>();
  const suggestions = results.filter(s => {
    const key = `${s.kind}:${s.insert}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);

  return { suggestions, word };
}

const KIND_LABEL: Record<SuggestionKind, string> = { keyword: 'kw', table: 'tbl', column: 'col' };

// ─── Component ────────────────────────────────────────────────────────────

interface Props {
  dbId: string;
  dbName: string;
  onVisualize?: (sql: string, chartType: ChartType, xColumn: string, yColumns: string[]) => void;
}

export default function QueryEditor({ dbId, dbName, onVisualize }: Props) {
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
  const [acVisible, setAcVisible] = useState(false);
  const [acWord, setAcWord] = useState('');
  const schemaTablesRef = useRef<TableInfo[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const acListRef = useRef<HTMLDivElement>(null);

  // Load schema for autocomplete
  useEffect(() => {
    api.getSchema(dbId)
      .then(s => { schemaTablesRef.current = s.tables; })
      .catch(() => { schemaTablesRef.current = []; });
  }, [dbId]);

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
    } catch (e: any) {
      setError(e.message);
      setResult(null);
    } finally {
      setLoading(false);
      if (showHistory) fetchHistory();
    }
  };

  // Accept the currently highlighted autocomplete suggestion
  const acceptSuggestion = useCallback((suggestion: Suggestion) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursor = textarea.selectionStart;
    const before = sql.slice(0, cursor);
    const after = sql.slice(cursor);
    const newBefore = before.replace(/[\w.]+$/, '') + suggestion.insert;
    const newSql = newBefore + after;
    setSql(newSql);
    setAcVisible(false);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = newBefore.length;
    });
  }, [sql]);

  const handleSqlChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setSql(value);
    const cursor = e.target.selectionStart;
    const { suggestions, word } = computeSuggestions(value, cursor, schemaTablesRef.current);
    if (suggestions.length > 0) {
      setAcSuggestions(suggestions);
      setAcWord(word);
      setAcIndex(0);
      setAcVisible(true);
    } else {
      setAcVisible(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (acVisible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAcIndex(i => {
          const next = Math.min(i + 1, acSuggestions.length - 1);
          // Scroll the highlighted item into view
          requestAnimationFrame(() => {
            acListRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
          });
          return next;
        });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAcIndex(i => {
          const next = Math.max(i - 1, 0);
          requestAnimationFrame(() => {
            acListRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
          });
          return next;
        });
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (acSuggestions[acIndex]) {
          e.preventDefault();
          acceptSuggestion(acSuggestions[acIndex]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAcVisible(false);
        return;
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      setAcVisible(false);
      run();
    }
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
    } catch (e: any) {
      setAiError(e.message);
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
        <div className="ac-wrapper">
          <textarea
            ref={textareaRef}
            value={sql}
            onChange={handleSqlChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setAcVisible(false), 120)}
            placeholder="SELECT * FROM table_name LIMIT 100;"
            spellCheck={false}
          />
          {acVisible && acSuggestions.length > 0 && (
            <div className="ac-dropdown" ref={acListRef}>
              {acSuggestions.map((s, i) => (
                <div
                  key={`${s.kind}:${s.insert}`}
                  className={`ac-item${i === acIndex ? ' ac-item-active' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(s); }}
                  onMouseEnter={() => setAcIndex(i)}
                >
                  <span className={`ac-badge ac-badge-${s.kind}`}>{KIND_LABEL[s.kind]}</span>
                  <span className="ac-label">{highlightMatch(s.label, acWord)}</span>
                  {s.detail && <span className="ac-detail">{s.detail}</span>}
                </div>
              ))}
              <div className="ac-footer">
                <span>↑↓ navigate</span>
                <span>Tab / Enter to insert</span>
                <span>Esc to close</span>
              </div>
            </div>
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

// Highlight the matched prefix in the suggestion label
function highlightMatch(label: string, word: string): React.ReactNode {
  if (!word || word.includes('.')) return label;
  const matchWord = word.includes('.') ? word.split('.').pop()! : word;
  if (!matchWord || !label.toLowerCase().startsWith(matchWord.toLowerCase())) return label;
  return (
    <>
      <strong>{label.slice(0, matchWord.length)}</strong>
      {label.slice(matchWord.length)}
    </>
  );
}
