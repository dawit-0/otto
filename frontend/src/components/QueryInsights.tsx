import { useMemo } from 'react';
import { type ChartType } from './charts/ChartRenderer';

interface Props {
  columns: string[];
  rows: Record<string, unknown>[];
  onVisualize: (chartType: ChartType, xColumn: string, yColumns: string[]) => void;
}

type ColType = 'number' | 'date' | 'text';

interface ColProfile {
  name: string;
  type: ColType;
  nullCount: number;
  stat: string;
  subStat?: string;
}

function inferType(values: unknown[]): ColType {
  const nonNull = values.filter((v) => v != null && v !== '');
  if (nonNull.length === 0) return 'text';

  const numHits = nonNull.filter((v) => !isNaN(Number(v))).length;
  if (numHits / nonNull.length >= 0.85) return 'number';

  const dateHits = nonNull.filter((v) => {
    const s = String(v);
    return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s);
  }).length;
  if (dateHits / nonNull.length >= 0.85) return 'date';

  return 'text';
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function profileCol(name: string, values: unknown[]): ColProfile {
  const nullCount = values.filter((v) => v == null || v === '').length;
  const nonNull = values.filter((v) => v != null && v !== '');
  const type = inferType(values);

  if (type === 'number') {
    const nums = nonNull.map((v) => Number(v)).filter((n) => !isNaN(n));
    if (nums.length === 0) return { name, type, nullCount, stat: 'no data' };
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    return {
      name, type, nullCount,
      stat: `${fmt(min)} – ${fmt(max)}`,
      subStat: `avg ${fmt(avg)}`,
    };
  }

  if (type === 'date') {
    const strs = nonNull.map((v) => String(v)).sort();
    return {
      name, type, nullCount,
      stat: strs[0]?.slice(0, 10) ?? '',
      subStat: `→ ${strs[strs.length - 1]?.slice(0, 10) ?? ''}`,
    };
  }

  // text
  const freq = new Map<string, number>();
  nonNull.forEach((v) => {
    const s = String(v);
    freq.set(s, (freq.get(s) ?? 0) + 1);
  });
  const unique = freq.size;
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    name, type, nullCount,
    stat: `${unique} unique`,
    subStat: top ? `top: ${String(top[0]).slice(0, 18)}` : undefined,
  };
}

function suggestViz(
  columns: string[],
  types: Record<string, ColType>
): { chartType: ChartType; xColumn: string; yColumns: string[] } {
  const nums = columns.filter((c) => types[c] === 'number');
  const dates = columns.filter((c) => types[c] === 'date');
  const texts = columns.filter((c) => types[c] === 'text');

  if (columns.length === 1 && nums.length === 1) {
    return { chartType: 'stat', xColumn: columns[0], yColumns: [columns[0]] };
  }
  if (dates.length > 0 && nums.length > 0) {
    return { chartType: 'line', xColumn: dates[0], yColumns: nums.slice(0, 3) };
  }
  if (texts.length > 0 && nums.length > 0) {
    return { chartType: 'bar', xColumn: texts[0], yColumns: nums.slice(0, 3) };
  }
  if (nums.length >= 2) {
    return { chartType: 'scatter', xColumn: nums[0], yColumns: [nums[1]] };
  }
  return { chartType: 'bar', xColumn: columns[0], yColumns: columns.slice(1, 2) };
}

const TYPE_ICON: Record<ColType, string> = {
  number: '#',
  date: '~',
  text: 'T',
};

const TYPE_LABEL: Record<ColType, string> = {
  number: 'number',
  date: 'date',
  text: 'text',
};

export default function QueryInsights({ columns, rows, onVisualize }: Props) {
  const { profiles, suggestion } = useMemo(() => {
    const valuesByCol: Record<string, unknown[]> = {};
    columns.forEach((c) => { valuesByCol[c] = rows.map((r) => r[c]); });

    const profiles = columns.map((c) => profileCol(c, valuesByCol[c]));
    const types: Record<string, ColType> = {};
    profiles.forEach((p) => { types[p.name] = p.type; });
    const suggestion = suggestViz(columns, types);

    return { profiles, suggestion };
  }, [columns, rows]);

  return (
    <div className="query-insights">
      <div className="query-insights-header">
        <span className="query-insights-label">Column Profile</span>
        <button
          className="btn btn-sm btn-insights-visualize"
          onClick={() => onVisualize(suggestion.chartType, suggestion.xColumn, suggestion.yColumns)}
          title={`Suggested: ${suggestion.chartType} chart`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <rect x="3" y="3" width="18" height="18" rx="2" /><polyline points="3 9 9 9 9 3" /><line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          Chart This
          <span className="query-insights-chart-badge">{suggestion.chartType}</span>
        </button>
      </div>

      <div className="query-insights-cards">
        {profiles.map((p) => (
          <div key={p.name} className={`query-insights-card qi-type-${p.type}`}>
            <div className="qi-card-header">
              <span className="qi-type-icon" title={TYPE_LABEL[p.type]}>{TYPE_ICON[p.type]}</span>
              <span className="qi-col-name" title={p.name}>{p.name}</span>
            </div>
            <div className="qi-stat">{p.stat}</div>
            {p.subStat && <div className="qi-sub-stat">{p.subStat}</div>}
            {p.nullCount > 0 && (
              <div className="qi-null-badge">{p.nullCount} null</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
