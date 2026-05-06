import { useEffect, useState } from 'react';
import { api, type ColumnProfile, type TableProfileResponse } from '../api';

interface Props {
  dbId: string;
  tableName: string;
}

function fmt(n: number | null, decimals = 2): string {
  if (n === null || n === undefined) return '—';
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

function pct(count: number, total: number): string {
  if (total === 0) return '0%';
  return ((count / total) * 100).toFixed(1) + '%';
}

function NullBar({ nullCount, total }: { nullCount: number; total: number }) {
  const fillPct = total > 0 ? (nullCount / total) * 100 : 0;
  const hasNulls = nullCount > 0;
  return (
    <div className="profiler-null-bar-wrap">
      <div className="profiler-null-bar-track">
        <div
          className="profiler-null-bar-fill"
          style={{ width: `${fillPct}%`, background: hasNulls ? 'var(--warning)' : 'var(--success)' }}
        />
      </div>
      <span className={`profiler-null-label${hasNulls ? ' has-nulls' : ' no-nulls'}`}>
        {hasNulls ? `${pct(nullCount, total)} null` : 'no nulls'}
      </span>
    </div>
  );
}

function TopValuesBar({ values, total }: { values: ColumnProfile['top_values']; total: number }) {
  if (values.length === 0) return <div className="profiler-empty-vals">no data</div>;
  const maxCount = values[0].count;
  return (
    <div className="profiler-top-values">
      {values.map((v) => (
        <div key={v.value} className="profiler-top-value-row">
          <span className="profiler-top-value-label" title={v.value}>{v.value}</span>
          <div className="profiler-top-value-bar-track">
            <div
              className="profiler-top-value-bar-fill"
              style={{ width: `${(v.count / maxCount) * 100}%` }}
            />
          </div>
          <span className="profiler-top-value-count">{v.count.toLocaleString()}</span>
          <span className="profiler-top-value-pct">{pct(v.count, total)}</span>
        </div>
      ))}
    </div>
  );
}

function ColumnCard({ col, total }: { col: ColumnProfile; total: number }) {
  const isNumeric = col.category === 'numeric';
  return (
    <div className={`profiler-card${isNumeric ? ' profiler-card-numeric' : ' profiler-card-text'}`}>
      <div className="profiler-card-header">
        <div className="profiler-card-name-row">
          <span className="profiler-card-name">{col.name}</span>
          <span className="profiler-card-type">{col.type || 'TEXT'}</span>
        </div>
        <NullBar nullCount={col.null_count} total={total} />
        <div className="profiler-card-unique">
          {col.unique_count.toLocaleString()} unique
          <span className="profiler-card-unique-pct">({pct(col.unique_count, total - col.null_count)})</span>
        </div>
      </div>

      {isNumeric && (
        <div className="profiler-numeric-stats">
          <div className="profiler-stat-group">
            <span className="profiler-stat-label">MIN</span>
            <span className="profiler-stat-value">{fmt(col.min)}</span>
          </div>
          <div className="profiler-stat-divider" />
          <div className="profiler-stat-group">
            <span className="profiler-stat-label">AVG</span>
            <span className="profiler-stat-value">{fmt(col.avg)}</span>
          </div>
          <div className="profiler-stat-divider" />
          <div className="profiler-stat-group">
            <span className="profiler-stat-label">MAX</span>
            <span className="profiler-stat-value">{fmt(col.max)}</span>
          </div>
        </div>
      )}

      <div className="profiler-card-section-label">
        {isNumeric ? 'Most common' : 'Top values'}
      </div>
      <TopValuesBar values={col.top_values} total={total} />
    </div>
  );
}

export default function TableProfiler({ dbId, tableName }: Props) {
  const [profile, setProfile] = useState<TableProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setProfile(null);
    api.profileTable(dbId, tableName)
      .then(setProfile)
      .catch((e) => setError(e.message ?? 'Failed to profile table'))
      .finally(() => setLoading(false));
  }, [dbId, tableName]);

  if (loading) {
    return (
      <div className="profiler-loading">
        <div className="profiler-loading-spinner" />
        Profiling {tableName}…
      </div>
    );
  }

  if (error) {
    return <div className="profiler-error">{error}</div>;
  }

  if (!profile) return null;

  return (
    <div className="profiler-root">
      <div className="profiler-summary">
        <span className="profiler-summary-stat">
          <strong>{profile.row_count.toLocaleString()}</strong> rows
        </span>
        <span className="profiler-summary-dot">·</span>
        <span className="profiler-summary-stat">
          <strong>{profile.columns.length}</strong> columns
        </span>
        <span className="profiler-summary-dot">·</span>
        <span className="profiler-summary-stat">
          <strong>{profile.columns.filter(c => c.category === 'numeric').length}</strong> numeric
        </span>
        <span className="profiler-summary-dot">·</span>
        <span className="profiler-summary-stat">
          <strong>{profile.columns.filter(c => c.null_count > 0).length}</strong> with nulls
        </span>
      </div>
      <div className="profiler-grid">
        {profile.columns.map((col) => (
          <ColumnCard key={col.name} col={col} total={profile.row_count} />
        ))}
      </div>
    </div>
  );
}
