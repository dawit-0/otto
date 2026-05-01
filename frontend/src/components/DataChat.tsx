import { useEffect, useRef, useState } from 'react';
import { api, type ChatResponse } from '../api';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  sql?: string | null;
  columns?: string[];
  rows?: Record<string, unknown>[];
  row_count?: number;
  sql_error?: string | null;
  loading?: boolean;
}

interface Props {
  dbId: string;
  dbName: string;
  onOpenInQuery: (sql: string) => void;
}

const SUGGESTIONS = [
  'How many rows are in each table?',
  'Show me the most recently added records',
  'What are the most common values in the main table?',
];

const msgId = (() => { let n = 0; return () => n++; })();

function renderText(text: string) {
  return text.split('\n').map((line, i) => (
    <span key={i}>{line}{i < text.split('\n').length - 1 && <br />}</span>
  ));
}

function SqlBlock({ sql, onOpenInQuery }: { sql: string; onOpenInQuery: (s: string) => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="chat-sql-block">
      <div className="chat-sql-header">
        <span className="chat-sql-label">SQL</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-sm chat-sql-btn" onClick={copy}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button className="btn btn-sm chat-sql-btn" onClick={() => onOpenInQuery(sql)}>
            Open in Query Editor ↗
          </button>
        </div>
      </div>
      <pre className="chat-sql-code">{sql}</pre>
    </div>
  );
}

function ResultsTable({ columns, rows, row_count }: { columns: string[]; rows: Record<string, unknown>[]; row_count: number }) {
  const MAX_PREVIEW = 8;
  const display = rows.slice(0, MAX_PREVIEW);
  const hidden = row_count - display.length;

  return (
    <div className="chat-result-wrap">
      <div className="chat-result-table-scroll">
        <table className="chat-result-table">
          <thead>
            <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {display.map((row, i) => (
              <tr key={i}>
                {columns.map(c => (
                  <td key={c} className={row[c] == null ? 'null-value' : ''}>
                    {row[c] == null ? 'NULL' : String(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="chat-result-footer">
        {hidden > 0
          ? `Showing ${display.length} of ${row_count} rows — open in Query Editor to see all`
          : `${row_count} row${row_count !== 1 ? 's' : ''}`}
      </div>
    </div>
  );
}

function AssistantBubble({ msg, onOpenInQuery }: { msg: Message; onOpenInQuery: (s: string) => void }) {
  if (msg.loading) {
    return (
      <div className="chat-thinking">
        <span /><span /><span />
      </div>
    );
  }

  // Split content around the SQL block so we preserve narrative structure
  const sqlBlockRegex = /```sql\s*[\s\S]*?```/i;
  const match = msg.content.match(sqlBlockRegex);
  const beforeSql = match ? msg.content.slice(0, match.index).trim() : msg.content.trim();
  const afterSql = match ? msg.content.slice((match.index ?? 0) + match[0].length).trim() : '';

  return (
    <>
      {beforeSql && <p className="chat-msg-text">{renderText(beforeSql)}</p>}
      {msg.sql && <SqlBlock sql={msg.sql} onOpenInQuery={onOpenInQuery} />}
      {afterSql && <p className="chat-msg-text">{renderText(afterSql)}</p>}
      {msg.sql && msg.sql_error && (
        <div className="chat-result-error">SQL error: {msg.sql_error}</div>
      )}
      {msg.sql && !msg.sql_error && msg.columns && msg.columns.length > 0 && (
        <ResultsTable columns={msg.columns} rows={msg.rows ?? []} row_count={msg.row_count ?? 0} />
      )}
    </>
  );
}

export default function DataChat({ dbId, dbName, onOpenInQuery }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || sending) return;

    setInput('');
    setGlobalError(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMsg: Message = { id: msgId(), role: 'user', content };
    const placeholder: Message = { id: msgId(), role: 'assistant', content: '', loading: true };

    setMessages(prev => [...prev, userMsg, placeholder]);
    setSending(true);

    // History to send: everything before the placeholder
    const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));

    try {
      const res: ChatResponse = await api.chat(dbId, history);
      setMessages(prev => prev.map(m =>
        m.id === placeholder.id
          ? { ...m, loading: false, content: res.message, sql: res.sql, columns: res.columns, rows: res.rows, row_count: res.row_count, sql_error: res.sql_error }
          : m
      ));
    } catch (e: unknown) {
      setMessages(prev => prev.filter(m => m.id !== placeholder.id));
      setGlobalError(e instanceof Error ? e.message : 'Something went wrong');
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

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">◈</div>
            <div className="chat-empty-title">Chat with {dbName}</div>
            <p className="chat-empty-text">
              Ask questions about your data in plain English. Otto will query the database and explain what it finds.
            </p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map(s => (
                <button key={s} className="chat-suggestion" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`chat-row chat-row-${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="chat-avatar">O</div>
            )}
            <div className={`chat-bubble chat-bubble-${msg.role}`}>
              {msg.role === 'user'
                ? <p className="chat-msg-text">{msg.content}</p>
                : <AssistantBubble msg={msg} onOpenInQuery={onOpenInQuery} />}
            </div>
          </div>
        ))}

        {globalError && (
          <div className="chat-global-error">{globalError}</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-bar">
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          rows={1}
          placeholder="Ask anything about your data…  (Shift+Enter for new line)"
          disabled={sending}
          onChange={e => { setInput(e.target.value); autoResize(); }}
          onKeyDown={handleKeyDown}
        />
        <button
          className="btn btn-primary chat-send-btn"
          onClick={() => send()}
          disabled={sending || !input.trim()}
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
