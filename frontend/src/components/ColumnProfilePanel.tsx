import { useEffect, useState } from 'react';
import { api, type TableProfileResponse, type ColumnProfile } from '../api';

interface Props {
  dbId: string;
  tableName: string;
  onClose: () => void;
}

function CompletenessBar({ nullPct }: { nullPct: number }) {
  const fillPct = 100 - nullPct;
  return (
    <div className="profile-completeness-bar">
      <div className="profile-completeness-fill" style={{ width: `${fillPct}%` }} />
    </div>
  );
}

function TopValueBar({ value, count, maxCount }: { value: string; count: number; maxCount: number }) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div className="profile-top-value-row">
      <span className="profile-top-value-label" title={value}>{value}</span>
      <div className="profile-top-value-bar-wrap">
        <div className="profile-top-value-bar" style={{ width: `${pct}%` }} />
      </div>
      <span className="profile-top-value-count">{count.toLocaleString()}</span>
    </div>
  );
}

function ColumnCard({ col }: { col: ColumnProfile }) {
  const [expanded, setExpanded] = useState(false);
  const completeness = 100 - col.null_pct;
  const maxTopCount = col.top_values[0]?.count ?? 1;
  const hasTopValues = col.top_values.length > 0;

  return (
    <div className="profile-col-card">
      <div className="profile-col-header" onClick={() => setExpanded((x) => !x)}>
        <div className="profile-col-name-row">
          <span className="profile-col-name">{col.name}</span>
          <span className="profile-col-type-badge">{col.type}</span>
          <svg
            className={`profile-chevron${expanded ? ' expanded' : ''}`}
            width="12" height="12" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>

        <CompletenessBar nullPct={col.null_pct} />

        <div className="profile-col-quick-stats">
          <span className={`profile-stat-chip${completeness < 100 ? ' has-nulls' : ''}`}>
            {col.null_count === 0
              ? 'No nulls'
              : `${col.null_count.toLocaleString()} null (${col.null_pct}%)`}
          </span>
          <span className="profile-stat-chip">
            {col.distinct_count.toLocaleString()} distinct
            {col.distinct_pct > 0 && col.distinct_pct < 100 && ` (${col.distinct_pct}%)`}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="profile-col-detail">
          {col.is_numeric && (col.min !== null || col.max !== null) && (
            <div className="profile-numeric-stats">
              {col.min !== null && (
                <div className="profile-numeric-stat">
                  <span className="profile-numeric-label">min</span>
                  <span className="profile-numeric-value">{col.min}</span>
                </div>
              )}
              {col.max !== null && (
                <div className="profile-numeric-stat">
                  <span className="profile-numeric-label">max</span>
                  <span className="profile-numeric-value">{col.max}</span>
                </div>
              )}
              {col.avg !== null && (
                <div className="profile-numeric-stat">
                  <span className="profile-numeric-label">avg</span>
                  <span className="profile-numeric-value">{col.avg}</span>
                </div>
              )}
            </div>
          )}

          {hasTopValues && (
            <div className="profile-top-values">
              <span className="profile-top-values-label">Top values</span>
              {col.top_values.map((tv) => (
                <TopValueBar
                  key={tv.value}
                  value={tv.value}
                  count={tv.count}
                  maxCount={maxTopCount}
                />
              ))}
            </div>
          )}

          {!col.is_numeric && !hasTopValues && (
            <span className="profile-high-card-note">High cardinality — top values not shown</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function ColumnProfilePanel({ dbId, tableName, onClose }: Props) {
  const [profile, setProfile] = useState<TableProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setProfile(null);
    api.getTableProfile(dbId, tableName)
      .then(setProfile)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load profile'))
      .finally(() => setLoading(false));
  }, [dbId, tableName]);

  return (
    <div className="profile-panel">
      <div className="profile-panel-header">
        <div className="profile-panel-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M3 15h18M9 3v18" />
          </svg>
          Column Profile
        </div>
        {profile && (
          <span className="profile-panel-subtitle">
            {profile.row_count.toLocaleString()} rows · {profile.columns.length} columns
          </span>
        )}
        <button className="btn-icon profile-close-btn" onClick={onClose} title="Close profile">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="profile-panel-body">
        {loading && (
          <div className="profile-loading">
            <div className="profile-spinner" />
            Analyzing columns…
          </div>
        )}

        {error && (
          <div className="profile-error">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        {!loading && !error && profile && (
          <div className="profile-col-list">
            {profile.columns.map((col) => (
              <ColumnCard key={col.name} col={col} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
