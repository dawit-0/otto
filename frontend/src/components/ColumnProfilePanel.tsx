import { useCallback, useEffect, useState } from 'react';
import { api, type ColumnProfile } from '../api';

interface Props {
  dbId: string;
  tableName: string;
  columnName: string;
  onClose: () => void;
}

function fmt(n: number | string | null): string {
  if (n === null || n === undefined) return '—';
  if (typeof n === 'number') {
    return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return String(n);
}

export default function ColumnProfilePanel({ dbId, tableName, columnName, onClose }: Props) {
  const [profile, setProfile] = useState<ColumnProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    setProfile(null);
    setLoading(true);
    setError(null);
    try {
      const data = await api.getColumnProfile(dbId, tableName, columnName);
      setProfile(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [dbId, tableName, columnName]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const maxTopCount = profile?.top_values[0]?.count ?? 1;

  return (
    <div className="col-profile-panel">
      <div className="col-profile-header">
        <div className="col-profile-title">
          <span className="col-profile-name">{columnName}</span>
          {profile && <span className="col-profile-type-badge">{profile.type || 'ANY'}</span>}
        </div>
        <button className="col-profile-close" onClick={onClose} title="Close">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {loading && (
        <div className="col-profile-loading">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="spin">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          Analyzing…
        </div>
      )}

      {error && <div className="col-profile-error">{error}</div>}

      {profile && (
        <div className="col-profile-body">
          <div className="col-profile-stats">
            <div className="col-profile-stat">
              <div className="col-profile-stat-value">{profile.total_count.toLocaleString()}</div>
              <div className="col-profile-stat-label">Total rows</div>
            </div>
            <div className="col-profile-stat">
              <div className="col-profile-stat-value">
                {profile.null_count.toLocaleString()}
                {profile.total_count > 0 && (
                  <span className="col-profile-stat-pct"> ({profile.null_percent}%)</span>
                )}
              </div>
              <div className="col-profile-stat-label">Null values</div>
            </div>
            <div className="col-profile-stat">
              <div className="col-profile-stat-value">{profile.unique_count.toLocaleString()}</div>
              <div className="col-profile-stat-label">
                {profile.unique_count === profile.total_count - profile.null_count && profile.total_count > 0
                  ? 'Unique (all)'
                  : 'Unique values'}
              </div>
            </div>
          </div>

          {profile.null_count > 0 && profile.total_count > 0 && (
            <div className="col-profile-null-bar-wrap" title={`${profile.null_percent}% null`}>
              <div className="col-profile-fill-bar">
                <div
                  className="col-profile-fill-bar-inner"
                  style={{ width: `${100 - profile.null_percent}%` }}
                />
              </div>
              <span className="col-profile-fill-label">
                {(100 - profile.null_percent).toFixed(1)}% filled
              </span>
            </div>
          )}

          {profile.is_numeric && (profile.min !== null || profile.max !== null) && (
            <div className="col-profile-numeric">
              <div className="col-profile-section-label">Range</div>
              <div className="col-profile-num-grid">
                <div className="col-profile-num-cell">
                  <span className="col-profile-num-label">Min</span>
                  <span className="col-profile-num-value">{fmt(profile.min)}</span>
                </div>
                <div className="col-profile-num-cell">
                  <span className="col-profile-num-label">Avg</span>
                  <span className="col-profile-num-value">{fmt(profile.avg)}</span>
                </div>
                <div className="col-profile-num-cell">
                  <span className="col-profile-num-label">Max</span>
                  <span className="col-profile-num-value">{fmt(profile.max)}</span>
                </div>
              </div>
            </div>
          )}

          {profile.top_values.length > 0 && (
            <div className="col-profile-top-values">
              <div className="col-profile-section-label">
                {profile.unique_count <= profile.top_values.length
                  ? 'All values'
                  : `Top ${profile.top_values.length} values`}
              </div>
              <div className="col-profile-values-list">
                {profile.top_values.map((tv, i) => {
                  const barPct = maxTopCount > 0 ? (tv.count / maxTopCount) * 100 : 0;
                  const totalPct =
                    profile.total_count > 0
                      ? ((tv.count / profile.total_count) * 100).toFixed(1)
                      : '0';
                  return (
                    <div key={i} className="col-profile-value-row">
                      <span className="col-profile-value-name" title={tv.value}>
                        {tv.value.length > 28 ? tv.value.slice(0, 26) + '…' : tv.value}
                      </span>
                      <div className="col-profile-value-bar-track">
                        <div
                          className="col-profile-value-bar-fill"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                      <span className="col-profile-value-meta">
                        {tv.count.toLocaleString()} <span className="col-profile-value-pct">({totalPct}%)</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
