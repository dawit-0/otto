import { useState, useRef, useEffect } from 'react';
import { api } from '../api';

interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface DisplayMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  answer?: string;
  sql?: string | null;
  columns?: string[] | null;
  rows?: Record<string, unknown>[] | null;
  row_count?: number | null;
  query_error?: string | null;
  loading?: boolean;
}

interface Props {
  dbId: string;
  onUseInEditor?: (sql: string) => void;
}

let nextId = 0;

export default function ChatPanel({ dbId, onUseInEditor }: Props) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [expandedSql, setExpandedSql] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    setMessages([]);
    setHistory([]);
    setInput('');
    setExpandedSql(new Set());
  }, [dbId]);

  const toggleSql = (id: number) => {
    setExpandedSql((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsgId = nextId++;
    const loadingMsgId = nextId++;

    const userMsg: DisplayMessage = { id: userMsgId, role: 'user', text };
    const loadingMsg: DisplayMessage = { id: loadingMsgId, role: 'assistant', text: '', loading: true };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setInput('');
    setSending(true);

    const nextHistory: HistoryMessage[] = [...history, { role: 'user', content: text }];

    try {
      const res = await api.chatWithAi(dbId, history, text);

      const assistantContent = JSON.stringify({ sql: res.sql, answer: res.answer });
      const updatedHistory: HistoryMessage[] = [
        ...nextHistory,
        { role: 'assistant', content: assistantContent },
      ];
      setHistory(updatedHistory);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsgId
            ? {
                id: loadingMsgId,
                role: 'assistant',
                text: res.answer,
                answer: res.answer,
                sql: res.sql,
                columns: res.columns,
                rows: res.rows,
                row_count: res.row_count,
                query_error: res.query_error,
              }
            : m,
        ),
      );

      if (res.sql) {
        setExpandedSql((prev) => new Set(prev).add(loadingMsgId));
      }
    } catch (e: unknown) {
      const errText = e instanceof Error ? e.message : 'Something went wrong.';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsgId
            ? { id: loadingMsgId, role: 'assistant', text: errText, answer: errText }
            : m,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setHistory([]);
    setExpandedSql(new Set());
    inputRef.current?.focus();
  };

  const PREVIEW_ROWS = 5;

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-header-title">Ask Otto</span>
        <span className="chat-header-hint">Ask anything about your data in plain English</span>
        {messages.length > 0 && (
          <button className="btn btn-sm chat-clear-btn" onClick={clearChat} title="New conversation">
            New chat
          </button>
        )}
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">&#9830;</div>
            <div className="chat-empty-title">Ask Otto anything</div>
            <div className="chat-empty-text">
              Try: "What are the top 10 rows by revenue?" or "Show me tables with the most data"
            </div>
            <div className="chat-suggestions">
              {['What tables are in this database?', 'Show me the first 5 rows of each table', 'Which columns have null values?'].map((s) => (
                <button
                  key={s}
                  className="chat-suggestion"
                  onClick={() => { setInput(s); inputRef.current?.focus(); }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message chat-message-${msg.role}`}>
            {msg.role === 'user' ? (
              <div className="chat-bubble chat-bubble-user">{msg.text}</div>
            ) : msg.loading ? (
              <div className="chat-bubble chat-bubble-assistant chat-bubble-loading">
                <span className="chat-dot" />
                <span className="chat-dot" />
                <span className="chat-dot" />
              </div>
            ) : (
              <div className="chat-bubble chat-bubble-assistant">
                {msg.answer && <p className="chat-answer-text">{msg.answer}</p>}

                {msg.sql && (
                  <div className="chat-sql-block">
                    <button
                      className="chat-sql-toggle"
                      onClick={() => toggleSql(msg.id)}
                    >
                      <span className="chat-sql-toggle-icon">
                        {expandedSql.has(msg.id) ? '▾' : '▸'}
                      </span>
                      SQL
                      {msg.row_count != null && (
                        <span className="chat-row-badge">{msg.row_count} rows</span>
                      )}
                      {msg.query_error && (
                        <span className="chat-error-badge">error</span>
                      )}
                    </button>
                    {expandedSql.has(msg.id) && (
                      <>
                        <pre className="chat-sql-code">{msg.sql}</pre>
                        <div className="chat-sql-actions">
                          {onUseInEditor && (
                            <button
                              className="btn btn-sm"
                              onClick={() => onUseInEditor(msg.sql!)}
                            >
                              Open in Editor
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {msg.query_error && (
                  <div className="chat-query-error">Query error: {msg.query_error}</div>
                )}

                {msg.columns && msg.rows && msg.rows.length > 0 && (
                  <div className="chat-results">
                    <div className="chat-results-table-wrap">
                      <table className="chat-results-table">
                        <thead>
                          <tr>
                            {msg.columns.map((col) => (
                              <th key={col}>{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {msg.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                            <tr key={i}>
                              {msg.columns!.map((col) => (
                                <td key={col}>
                                  {row[col] == null ? (
                                    <span className="chat-null">null</span>
                                  ) : (
                                    String(row[col])
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {msg.rows.length > PREVIEW_ROWS && (
                      <div className="chat-results-overflow">
                        +{msg.rows.length - PREVIEW_ROWS} more rows — open in Editor to see all
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your data... (Enter to send, Shift+Enter for newline)"
          rows={2}
          disabled={sending}
        />
        <button
          className="btn btn-primary chat-send-btn"
          onClick={send}
          disabled={sending || !input.trim()}
        >
          {sending ? '...' : 'Ask'}
        </button>
      </div>
    </div>
  );
}
