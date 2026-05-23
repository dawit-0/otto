import { useMemo } from 'react';

interface Bucket { label: string; count: number }
interface TopValue { value: string; count: number }

export interface ColumnProfile {
  name: string;
  totalCount: number;
  nullCount: number;
  distinctCount: number;
  inferredType: 'numeric' | 'text' | 'boolean' | 'date' | 'mixed' | 'unknown';
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  histogram?: Bucket[];
  avgLength?: number;
  topValues?: TopValue[];
}

function inferType(nonNull: unknown[]): ColumnProfile['inferredType'] {
  if (nonNull.length === 0) return 'unknown';
  let numeric = 0, bool = 0, date = 0, text = 0;
  for (const v of nonNull) {
    if (typeof v === 'boolean') { bool++; continue; }
    if (typeof v === 'number') { numeric++; continue; }
    if (typeof v === 'string') {
      const s = v.trim();
      if (s === 'true' || s === 'false') { bool++; continue; }
      if (!isNaN(Number(s)) && s !== '') { numeric++; continue; }
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) { date++; continue; }
    }
    text++;
  }
  const n = nonNull.length;
  if (numeric / n > 0.85) return 'numeric';
  if (bool / n > 0.85) return 'boolean';
  if (date / n > 0.5) return 'date';
  if (text / n > 0.5) return 'text';
  return 'mixed';
}

function shortNum(n: number): string {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

export function computeProfile(column: string, rows: Record<string, unknown>[]): ColumnProfile {
  const values = rows.map((r) => r[column]);
  const totalCount = values.length;
  const nullCount = values.filter((v) => v === null || v === undefined || v === '').length;
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '');
  const distinctCount = new Set(nonNull.map((v) => String(v))).size;
  const inferredType = inferType(nonNull);

  const profile: ColumnProfile = { name: column, totalCount, nullCount, distinctCount, inferredType };

  if (inferredType === 'numeric') {
    const nums = nonNull
      .map((v) => (typeof v === 'number' ? v : Number(v)))
      .filter((n) => !isNaN(n));
    if (nums.length > 0) {
      profile.min = Math.min(...nums);
      profile.max = Math.max(...nums);
      profile.mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      profile.median =
        sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

      const range = profile.max - profile.min;
      const bucketCount = Math.min(12, distinctCount);
      if (range > 0 && bucketCount > 1) {
        const size = range / bucketCount;
        const buckets = new Array(bucketCount).fill(0);
        for (const n of nums) {
          const idx = Math.min(Math.floor((n - profile.min) / size), bucketCount - 1);
          buckets[idx]++;
        }
        profile.histogram = buckets.map((count, i) => ({
          label: shortNum(profile.min! + i * size),
          count,
        }));
      } else if (distinctCount > 0) {
        const counts = new Map<number, number>();
        for (const n of nums) counts.set(n, (counts.get(n) ?? 0) + 1);
        profile.histogram = [...counts.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([val, count]) => ({ label: shortNum(val), count }));
      }
    }
  }

  if (inferredType !== 'numeric') {
    const strs = nonNull.map((v) => String(v));
    if (strs.length > 0 && inferredType === 'text') {
      profile.avgLength = strs.reduce((a, s) => a + s.length, 0) / strs.length;
    }
    const counts = new Map<string, number>();
    for (const s of strs) counts.set(s, (counts.get(s) ?? 0) + 1);
    profile.topValues = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([value, count]) => ({ value, count }));
  }

  return profile;
}

interface Props {
  column: string;
  rows: Record<string, unknown>[];
  onClose: () => void;
}

export default function ColumnProfiler({ column, rows, onClose }: Props) {
  const p = useMemo(() => computeProfile(column, rows), [column, rows]);

  const nullPct = p.totalCount > 0 ? (p.nullCount / p.totalCount) * 100 : 0;
  const filledCount = p.totalCount - p.nullCount;
  const uniquePct = filledCount > 0 ? Math.min((p.distinctCount / filledCount) * 100, 100) : 0;
  const maxHist = p.histogram ? Math.max(...p.histogram.map((b) => b.count), 1) : 1;
  const maxTop = p.topValues ? Math.max(...p.topValues.map((v) => v.count), 1) : 1;

  const typeBadgeClass = {
    numeric: 'profiler-type-numeric',
    text: 'profiler-type-text',
    boolean: 'profiler-type-bool',
    date: 'profiler-type-date',
    mixed: 'profiler-type-mixed',
    unknown: 'profiler-type-mixed',
  }[p.inferredType];

  return (
    <div className="profiler-panel">
      <div className="profiler-header">
        <div className="profiler-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          <span className="profiler-col-name">{p.name}</span>
          <span className={`profiler-type-badge ${typeBadgeClass}`}>{p.inferredType}</span>
        </div>
        <button className="btn-icon" onClick={onClose} title="Close profiler">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="profiler-body">
        {/* Top-level counts */}
        <div className="profiler-stat-grid">
          <div className="profiler-stat">
            <div className="profiler-stat-value">{p.totalCount.toLocaleString()}</div>
            <div className="profiler-stat-label">Total</div>
          </div>
          <div className="profiler-stat">
            <div className="profiler-stat-value">{filledCount.toLocaleString()}</div>
            <div className="profiler-stat-label">Non-null</div>
          </div>
          <div className="profiler-stat">
            <div className="profiler-stat-value">{p.distinctCount.toLocaleString()}</div>
            <div className="profiler-stat-label">Distinct</div>
          </div>
        </div>

        {/* Fill / null bars */}
        <div className="profiler-bars">
          <div className="profiler-bar-row">
            <span className="profiler-bar-label">Filled</span>
            <div className="profiler-bar-track">
              <div className="profiler-bar-fill" style={{ width: `${100 - nullPct}%` }} />
            </div>
            <span className="profiler-bar-pct">{(100 - nullPct).toFixed(1)}%</span>
          </div>
          <div className="profiler-bar-row">
            <span className="profiler-bar-label">Null</span>
            <div className="profiler-bar-track">
              <div className="profiler-bar-fill profiler-bar-null" style={{ width: `${nullPct}%` }} />
            </div>
            <span className="profiler-bar-pct">{nullPct.toFixed(1)}%</span>
          </div>
          <div className="profiler-bar-row">
            <span className="profiler-bar-label">Unique</span>
            <div className="profiler-bar-track">
              <div className="profiler-bar-fill profiler-bar-unique" style={{ width: `${uniquePct}%` }} />
            </div>
            <span className="profiler-bar-pct">{uniquePct.toFixed(0)}%</span>
          </div>
        </div>

        {/* Numeric stats + histogram */}
        {p.inferredType === 'numeric' && p.min !== undefined && (
          <>
            <div className="profiler-section-title">Stats</div>
            <div className="profiler-numeric-stats">
              <div className="profiler-num-stat">
                <span>Min</span><strong>{shortNum(p.min)}</strong>
              </div>
              <div className="profiler-num-stat">
                <span>Max</span><strong>{shortNum(p.max!)}</strong>
              </div>
              <div className="profiler-num-stat">
                <span>Mean</span><strong>{shortNum(p.mean!)}</strong>
              </div>
              <div className="profiler-num-stat">
                <span>Median</span><strong>{shortNum(p.median!)}</strong>
              </div>
            </div>

            {p.histogram && p.histogram.length > 1 && (
              <>
                <div className="profiler-section-title">Distribution</div>
                <div className="profiler-histogram">
                  {p.histogram.map((bucket, i) => (
                    <div
                      key={i}
                      className="profiler-histogram-col"
                      title={`${bucket.label}: ${bucket.count} row${bucket.count !== 1 ? 's' : ''}`}
                    >
                      <div
                        className="profiler-histogram-bar"
                        style={{ height: `${Math.max(3, (bucket.count / maxHist) * 100)}%` }}
                      />
                      {(i === 0 || i === p.histogram!.length - 1) && (
                        <div className="profiler-histogram-label">{bucket.label}</div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* Top values for text / boolean / date / mixed */}
        {p.topValues && p.topValues.length > 0 && p.inferredType !== 'numeric' && (
          <>
            <div className="profiler-section-title">
              Top Values
              {p.avgLength !== undefined && (
                <span className="profiler-section-sub">avg {p.avgLength.toFixed(1)} chars</span>
              )}
            </div>
            <div className="profiler-top-values">
              {p.topValues.map(({ value, count }) => (
                <div key={value} className="profiler-top-value-row">
                  <div className="profiler-top-value-bar-track">
                    <div
                      className="profiler-top-value-bar"
                      style={{ width: `${(count / maxTop) * 100}%` }}
                    />
                    <span className="profiler-top-value-text" title={value}>
                      {value === '' ? <em style={{ opacity: 0.5 }}>(empty)</em> : value}
                    </span>
                  </div>
                  <span className="profiler-top-value-count">{count}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
