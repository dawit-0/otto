import { useEffect, useState } from 'react';
import { api, type ColumnProfile } from '../api';

interface Props {
  dbId: string;
  tableName: string;
  columnName: string;
  columnType: string;
  onClose: () => void;
}

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined) return '—';
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function pct(part: number, total: number): string {
  if (total === 0) return '0%';
  return ((part / total) * 100).toFixed(1) + '%';
}

function typeCategory(raw: string): 'numeric' | 'text' {
  const t = raw.toUpperCase();
  if (['INT', 'REAL', 'FLOAT', 'DOUBLE', 'NUMERIC', 'DECIMAL', 'NUMBER'].some((k) => t.includes(k))) {
    return 'numeric';
  }
  return 'text';
}

export default function ColumnProfilePanel({ dbId, tableName, columnName, columnType, onClose }: Props) {
  const [profile, setProfile] = useState<ColumnProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setProfile(null);
    api.getColumnProfile(dbId, tableName, columnName)
      .then(setProfile)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [dbId, tableName, columnName]);

  const kind = typeCategory(columnType);
  const maxTopCount = profile?.top_values[0]?.count ?? 1;

  return (
    <div className="col-profile-panel">
      <div className="col-profile-header">
        <div className="col-profile-title-group">
          <span className="col-profile-table">{tableName}</span>
          <span className="col-profile-dot">.</span>
          <span className="col-profile-col">{columnName}</span>
        </div>
        <button className="btn-icon" onClick={onClose} title="Close">&#x2715;</button>
      </div>

      <div className="col-profile-type-badge">{columnType || 'any'}</div>

      {loading && (
        <div className="col-profile-loading">Profiling column…</div>
      )}

      {error && (
        <div className="col-profile-error">{error}</div>
      )}

      {profile && !loading && (
        <div className="col-profile-body">
          {/* Key stat cards */}
          <div className="col-profile-stats">
            <div className="col-profile-stat">
              <div className="col-profile-stat-value">{fmt(profile.total_count, 0)}</div>
              <div className="col-profile-stat-label">Total rows</div>
            </div>
            <div className="col-profile-stat">
              <div className="col-profile-stat-value">{fmt(profile.distinct_count, 0)}</div>
              <div className="col-profile-stat-label">Distinct</div>
            </div>
            <div className={`col-profile-stat${profile.null_count > 0 ? ' col-profile-stat--warn' : ''}`}>
              <div className="col-profile-stat-value">{pct(profile.null_count, profile.total_count)}</div>
              <div className="col-profile-stat-label">Null</div>
            </div>
          </div>

          {/* Numeric min/max/avg */}
          {kind === 'numeric' && profile.non_null_count > 0 && (
            <div className="col-profile-section">
              <div className="col-profile-section-title">Range</div>
              <div className="col-profile-range">
                <div className="col-profile-range-item">
                  <span className="col-profile-range-label">min</span>
                  <span className="col-profile-range-value">{fmt(profile.min)}</span>
                </div>
                <div className="col-profile-range-item">
                  <span className="col-profile-range-label">avg</span>
                  <span className="col-profile-range-value">{fmt(profile.avg)}</span>
                </div>
                <div className="col-profile-range-item">
                  <span className="col-profile-range-label">max</span>
                  <span className="col-profile-range-value">{fmt(profile.max)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Top values frequency chart */}
          {profile.top_values.length > 0 && (
            <div className="col-profile-section">
              <div className="col-profile-section-title">
                Top values
                <span className="col-profile-section-sub">by frequency</span>
              </div>
              <div className="col-profile-freq">
                {profile.top_values.map((tv) => (
                  <div key={tv.value} className="col-profile-freq-row">
                    <div className="col-profile-freq-label" title={tv.value}>{tv.value}</div>
                    <div className="col-profile-freq-bar-track">
                      <div
                        className="col-profile-freq-bar-fill"
                        style={{ width: `${(tv.count / maxTopCount) * 100}%` }}
                      />
                    </div>
                    <div className="col-profile-freq-count">{tv.count.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {profile.non_null_count === 0 && (
            <div className="col-profile-empty">All values are null</div>
          )}
        </div>
      )}
    </div>
  );
}
