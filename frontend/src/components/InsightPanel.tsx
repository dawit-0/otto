import { useState } from 'react';
import { api } from '../api';

interface Props {
  dbId: string;
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

type State = 'idle' | 'loading' | 'done' | 'error';

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

function renderInsight(text: string) {
  return text.split('\n').map((line, i) => {
    if (!line.trim()) return <div key={i} className="insight-spacer" />;
    const trimmed = line.trimStart();
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      const content = trimmed.replace(/^[-•]\s*/, '');
      return <li key={i} className="insight-list-item">{renderInlineMarkdown(content)}</li>;
    }
    return <p key={i} className="insight-line">{renderInlineMarkdown(line)}</p>;
  });
}

export default function InsightPanel({ dbId, sql, columns, rows }: Props) {
  const [state, setState] = useState<State>('idle');
  const [insight, setInsight] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const analyze = async () => {
    setState('loading');
    setError(null);
    try {
      const res = await api.analyzeResults(dbId, sql, columns, rows);
      setInsight(res.insight);
      setState('done');
    } catch (e: any) {
      setError(e.message);
      setState('error');
    }
  };

  if (state === 'idle') {
    return (
      <button className="btn btn-insight-trigger" onClick={analyze}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        Explain Results
      </button>
    );
  }

  return (
    <div className="insight-panel">
      <div className="insight-panel-header">
        <div className="insight-panel-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          AI Insights
        </div>
        <div className="insight-panel-actions">
          {state === 'done' && (
            <button className="btn-icon" onClick={analyze} title="Re-analyze">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          )}
          <button className="btn-icon" onClick={() => setDismissed(true)} title="Dismiss">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {state === 'loading' && (
        <div className="insight-loading">
          <span className="insight-loading-dot" />
          <span className="insight-loading-dot" />
          <span className="insight-loading-dot" />
          <span className="insight-loading-label">Analyzing your results…</span>
        </div>
      )}

      {state === 'done' && insight && (
        <div className="insight-body">{renderInsight(insight)}</div>
      )}

      {state === 'error' && (
        <div className="insight-error">
          <span>{error || 'Could not generate insights.'}</span>
          <button className="btn btn-sm" onClick={analyze}>Retry</button>
        </div>
      )}
    </div>
  );
}
