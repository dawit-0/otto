interface InsightItem {
  type: 'trend' | 'anomaly' | 'pattern' | 'stat';
  text: string;
}

interface FollowUpQuery {
  description: string;
  sql: string;
}

export interface InsightsData {
  summary: string;
  insights: InsightItem[];
  follow_up_queries: FollowUpQuery[];
}

interface Props {
  data: InsightsData;
  onLoadQuery?: (sql: string) => void;
}

const TYPE_ICON: Record<string, string> = {
  trend: '↗',
  anomaly: '!',
  pattern: '◈',
  stat: '∑',
};

export default function AiInsights({ data, onLoadQuery }: Props) {
  return (
    <div className="ai-insights-panel">
      <div className="ai-insights-summary">
        <span className="ai-insights-summary-icon">✦</span>
        {data.summary}
      </div>

      {data.insights.length > 0 && (
        <div className="ai-insights-section">
          <div className="ai-insights-section-label">Findings</div>
          <div className="ai-insights-list">
            {data.insights.map((insight, i) => (
              <div key={i} className={`ai-insight-item ai-insight-${insight.type}`}>
                <span className="ai-insight-icon" title={insight.type}>
                  {TYPE_ICON[insight.type] ?? '•'}
                </span>
                <span className="ai-insight-text">{insight.text}</span>
                <span className="ai-insight-type-badge">{insight.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.follow_up_queries.length > 0 && (
        <div className="ai-insights-section">
          <div className="ai-insights-section-label">Explore Further</div>
          <div className="ai-followup-list">
            {data.follow_up_queries.map((fq, i) => (
              <button
                key={i}
                className="ai-followup-item"
                onClick={() => onLoadQuery?.(fq.sql)}
                title={fq.sql}
                disabled={!onLoadQuery}
              >
                <span className="ai-followup-desc">{fq.description}</span>
                <svg
                  className="ai-followup-arrow"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
