import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { api, type TableProfileResponse, type ColumnProfile } from '../api';

interface Props {
  dbId: string;
  tableName: string;
}

function NullBar({ pct }: { pct: number }) {
  const filled = Math.max(0, Math.min(100, pct));
  // green at 0%, amber at 50%, red at 100%
  const hue = Math.round(120 - filled * 1.2);
  return (
    <div className="profiler-null-bar-wrap" title={`${pct}% null`}>
      <div className="profiler-null-bar-track">
        <div
          className="profiler-null-bar-fill"
          style={{ width: `${filled}%`, background: `hsl(${hue},70%,45%)` }}
        />
      </div>
      <span className="profiler-null-label">{pct}% null</span>
    </div>
  );
}

function NumericHistogram({ histogram, min, max }: {
  histogram: { bucket_start: number; bucket_end: number; count: number }[];
  min: number | null | undefined;
  max: number | null | undefined;
}) {
  if (!histogram || histogram.length === 0) return null;
  const fmt = (v: number | null | undefined) => {
    if (v == null) return '—';
    return Math.abs(v) >= 1e6 ? v.toExponential(2) : Number(v.toPrecision(4)).toString();
  };
  return (
    <div className="profiler-histogram">
      <ResponsiveContainer width="100%" height={52}>
        <BarChart data={histogram} margin={{ top: 2, right: 0, left: 0, bottom: 0 }} barCategoryGap={2}>
          <XAxis dataKey="bucket_start" hide />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="profiler-tooltip">
                  <span>{fmt(d.bucket_start)}–{fmt(d.bucket_end)}</span>
                  <span>{d.count.toLocaleString()} rows</span>
                </div>
              );
            }}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {histogram.map((_, i) => (
              <Cell key={i} fill="var(--accent)" fillOpacity={0.75} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="profiler-hist-range">
        <span>{fmt(min)}</span>
        <span>{fmt(max)}</span>
      </div>
    </div>
  );
}

function TopValuesBars({ topValues }: { topValues: { value: string; count: number }[] }) {
  if (!topValues || topValues.length === 0) return null;
  const maxCount = topValues[0]?.count ?? 1;
  return (
    <div className="profiler-top-values">
      {topValues.slice(0, 8).map((tv) => (
        <div key={tv.value} className="profiler-top-row">
          <span className="profiler-top-label" title={tv.value}>{tv.value || <em>empty</em>}</span>
          <div className="profiler-top-bar-track">
            <div
              className="profiler-top-bar-fill"
              style={{ width: `${(tv.count / maxCount) * 100}%` }}
            />
          </div>
          <span className="profiler-top-count">{tv.count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function AffinityBadge({ affinity, type }: { affinity: string; type: string }) {
  const label = type || affinity;
  const cls = affinity === 'numeric' ? 'badge-numeric' : affinity === 'text' ? 'badge-text' : 'badge-other';
  return <span className={`profiler-badge ${cls}`}>{label || 'BLOB'}</span>;
}

function ColumnCard({ col, rowCount }: { col: ColumnProfile; rowCount: number }) {
  const isAllNull = col.null_count === rowCount && rowCount > 0;
  const isUnique = col.unique_pct === 100 && rowCount > 0;

  return (
    <div className="profiler-card">
      <div className="profiler-card-header">
        <span className="profiler-col-name">{col.name}</span>
        <AffinityBadge affinity={col.affinity} type={col.type} />
        {isUnique && <span className="profiler-badge badge-unique">unique</span>}
      </div>

      <NullBar pct={col.null_pct} />

      <div className="profiler-stats-row">
        <div className="profiler-stat">
          <span className="profiler-stat-value">{col.unique_count.toLocaleString()}</span>
          <span className="profiler-stat-label">distinct</span>
        </div>
        {col.affinity === 'numeric' && !isAllNull && (
          <>
            <div className="profiler-stat">
              <span className="profiler-stat-value">
                {col.avg != null ? Number(col.avg.toPrecision(4)) : '—'}
              </span>
              <span className="profiler-stat-label">avg</span>
            </div>
            <div className="profiler-stat">
              <span className="profiler-stat-value">
                {col.min != null ? Number(Number(col.min).toPrecision(4)) : '—'}
              </span>
              <span className="profiler-stat-label">min</span>
            </div>
            <div className="profiler-stat">
              <span className="profiler-stat-value">
                {col.max != null ? Number(Number(col.max).toPrecision(4)) : '—'}
              </span>
              <span className="profiler-stat-label">max</span>
            </div>
          </>
        )}
        {col.affinity === 'text' && col.avg_length != null && (
          <div className="profiler-stat">
            <span className="profiler-stat-value">{col.avg_length}</span>
            <span className="profiler-stat-label">avg len</span>
          </div>
        )}
      </div>

      {col.affinity === 'numeric' && col.histogram && col.histogram.length > 0 && !isAllNull && (
        <NumericHistogram histogram={col.histogram} min={col.min} max={col.max} />
      )}

      {col.affinity === 'text' && col.top_values && col.top_values.length > 0 && !isAllNull && (
        <TopValuesBars topValues={col.top_values} />
      )}

      {isAllNull && (
        <div className="profiler-all-null">All values are NULL</div>
      )}

      {col.sample_values.length > 0 && !isAllNull && (
        <div className="profiler-samples">
          {col.sample_values.map((v, i) => (
            <span key={i} className="profiler-sample">{String(v)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TableProfiler({ dbId, tableName }: Props) {
  const [profile, setProfile] = useState<TableProfileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dbId || !tableName) return;
    setLoading(true);
    setError(null);
    setProfile(null);
    api.getTableProfile(dbId, tableName)
      .then(setProfile)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [dbId, tableName]);

  if (loading) {
    return (
      <div className="profiler-loading">
        <div className="profiler-spinner" />
        <span>Profiling {tableName}…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon" style={{ color: 'var(--danger)' }}>!</div>
        <div className="empty-state-title">Profile failed</div>
        <div className="empty-state-text">{error}</div>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="profiler-root">
      <div className="profiler-summary">
        <span className="profiler-summary-stat">
          <strong>{profile.row_count.toLocaleString()}</strong> rows
        </span>
        <span className="profiler-summary-sep">·</span>
        <span className="profiler-summary-stat">
          <strong>{profile.columns.length}</strong> columns
        </span>
      </div>
      <div className="profiler-grid">
        {profile.columns.map((col) => (
          <ColumnCard key={col.name} col={col} rowCount={profile.row_count} />
        ))}
      </div>
    </div>
  );
}
