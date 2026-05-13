import { useState, useRef, useEffect } from 'react';
import { api } from '../api';

interface Message {
  id: number;
  type: 'user' | 'otto';
  question?: string;
  sql?: string;
  explanation?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  row_count?: number;
  error?: string;
  loading?: boolean;
}

interface Props {
  dbId: string;
  dbName: string;
  onUseSql?: (sql: string) => void;
}

let msgId = 0;

export default function AskOtto({ dbId, onUseSql }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [copiedSql, setCopiedSql] = useState<number | null>(null);
  const [collapsedSql, setCollapsedSql] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const toggleSql = (id: number) => {
    setCollapsedSql((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copySql = async (id: number, sql: string) => {
    await navigator.clipboard.writeText(sql);
    setCopiedSql(id);
    setTimeout(() => setCopiedSql(null), 1500);
  };

  const ask = async () => {
    const question = input.trim();
    if (!question) return;

    const userId = ++msgId;
    const ottoId = ++msgId;

    setMessages((prev) => [
      ...prev,
      { id: userId, type: 'user', question },
      { id: ottoId, type: 'otto', loading: true },
    ]);
    setInput('');

    try {
      const res = await api.askOtto(dbId, question);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === ottoId
            ? {
                ...m,
                loading: false,
                sql: res.sql,
                explanation: res.explanation,
                columns: res.columns,
                rows: res.rows,
                row_count: res.row_count,
              }
            : m,
        ),
      );
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Something went wrong';
      setMessages((prev) =>
        prev.map((m) => (m.id === ottoId ? { ...m, loading: false, error } : m)),
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  };

  const isLoading = messages.some((m) => m.loading);

  return (
    <div className="ask-otto-layout">
      <div className="ask-otto-messages">
        {messages.length === 0 && (
          <div className="ask-otto-empty">
            <div className="ask-otto-empty-icon">◆</div>
            <div className="ask-otto-empty-title">Ask Otto anything about your data</div>
            <div className="ask-otto-empty-text">
              Type a question in plain English and Otto will query your database and explain what it found.
            </div>
            <div className="ask-otto-suggestions">
              {['How many rows are in each table?', 'Show me the top 10 records by date', 'What are the unique values in this database?'].map((s) => (
                <button key={s} className="ask-otto-suggestion" onClick={() => setInput(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`ask-otto-msg ask-otto-msg-${msg.type}`}>
            {msg.type === 'user' && (
              <div className="ask-otto-user-bubble">{msg.question}</div>
            )}

            {msg.type === 'otto' && (
              <div className="ask-otto-otto-bubble">
                <div className="ask-otto-avatar">◆</div>
                <div className="ask-otto-response">
                  {msg.loading && (
                    <div className="ask-otto-thinking">
                      <span className="ask-otto-dot" />
                      <span className="ask-otto-dot" />
                      <span className="ask-otto-dot" />
                    </div>
                  )}

                  {msg.error && (
                    <div className="ask-otto-error">{msg.error}</div>
                  )}

                  {!msg.loading && !msg.error && msg.sql && (
                    <>
                      {msg.explanation && (
                        <div className="ask-otto-explanation">{msg.explanation}</div>
                      )}

                      <div className="ask-otto-sql-block">
                        <div className="ask-otto-sql-header">
                          <button
                            className="ask-otto-sql-toggle"
                            onClick={() => toggleSql(msg.id)}
                          >
                            <span className="ask-otto-sql-label">SQL</span>
                            <span className="ask-otto-sql-chevron">
                              {collapsedSql.has(msg.id) ? '▸' : '▾'}
                            </span>
                          </button>
                          <div className="ask-otto-sql-actions">
                            <button
                              className={`btn-icon ask-otto-action-btn${copiedSql === msg.id ? ' copied' : ''}`}
                              onClick={() => copySql(msg.id, msg.sql!)}
                              title="Copy SQL"
                            >
                              {copiedSql === msg.id ? '✓' : (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                              )}
                            </button>
                            {onUseSql && (
                              <button
                                className="btn btn-sm ask-otto-use-sql"
                                onClick={() => onUseSql(msg.sql!)}
                                title="Open in Query Editor"
                              >
                                Open in Editor
                              </button>
                            )}
                          </div>
                        </div>
                        {!collapsedSql.has(msg.id) && (
                          <pre className="ask-otto-sql-code">{msg.sql}</pre>
                        )}
                      </div>

                      {msg.columns && msg.columns.length > 0 && msg.rows && (
                        <div className="ask-otto-results">
                          <div className="ask-otto-results-meta">
                            {msg.row_count} row{msg.row_count !== 1 ? 's' : ''}
                          </div>
                          <div className="ask-otto-table-wrap">
                            <table className="ask-otto-table">
                              <thead>
                                <tr>
                                  {msg.columns.map((col) => (
                                    <th key={col}>{col}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {msg.rows.slice(0, 50).map((row, i) => (
                                  <tr key={i}>
                                    {msg.columns!.map((col) => (
                                      <td
                                        key={col}
                                        className={row[col] == null ? 'null-value' : ''}
                                      >
                                        {row[col] == null ? 'NULL' : String(row[col])}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {msg.rows.length > 50 && (
                            <div className="ask-otto-truncated">
                              Showing 50 of {msg.row_count} rows — open in Editor to see all
                            </div>
                          )}
                        </div>
                      )}

                      {msg.columns && msg.columns.length === 0 && (
                        <div className="ask-otto-no-rows">Query returned no rows.</div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="ask-otto-input-area">
        <div className="ask-otto-input-row">
          <textarea
            ref={inputRef}
            className="ask-otto-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your data..."
            rows={1}
            disabled={isLoading}
          />
          <button
            className="btn btn-primary ask-otto-send"
            onClick={ask}
            disabled={isLoading || !input.trim()}
          >
            Ask
          </button>
        </div>
        <div className="ask-otto-hint">Enter to send · Shift+Enter for new line</div>
      </div>
    </div>
  );
}
