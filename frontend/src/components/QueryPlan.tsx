import { useState } from 'react';
import { type ExplainPlanResponse } from '../api';

interface Props {
  plan: ExplainPlanResponse;
  dbType?: 'sqlite' | 'postgres';
}

/**
 * Collapsible panel that renders the output of the database's EXPLAIN ANALYZE
 * equivalent. The backend normalizes PostgreSQL and SQLite plans into a common
 * shape, so this component stays dialect-agnostic and just displays it.
 */
export default function QueryPlan({ plan, dbType }: Props) {
  const [expanded, setExpanded] = useState(true);

  const engineLabel = dbType === 'postgres' ? 'PostgreSQL' : 'SQLite';
  const summaryEntries = Object.entries(plan.summary || {});

  return (
    <div className="query-plan">
      <button
        className="query-plan-header"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className={`query-plan-chevron${expanded ? ' expanded' : ''}`}>{'▶'}</span>
        <span className="query-plan-title">Query Plan</span>
        <code className="query-plan-command">{plan.command}</code>
        <span className="query-plan-engine">{engineLabel}</span>
        {summaryEntries.length > 0 && (
          <span className="query-plan-summary">
            {summaryEntries.map(([label, value]) => (
              <span key={label} className="query-plan-metric">
                <span className="query-plan-metric-label">{label}</span>
                <span className="query-plan-metric-value">{value}</span>
              </span>
            ))}
          </span>
        )}
      </button>
      {expanded && (
        <pre className="query-plan-body">{plan.text || 'No plan information available.'}</pre>
      )}
    </div>
  );
}
