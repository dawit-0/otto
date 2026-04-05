import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  AreaChart, Area,
  PieChart, Pie, Cell,
  ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

export type ChartType = 'line' | 'bar' | 'area' | 'pie' | 'scatter' | 'stat' | 'gauge' | 'table';

export const CHART_TYPES: { value: ChartType; label: string; icon: string }[] = [
  { value: 'line', label: 'Line', icon: '\u2571' },
  { value: 'bar', label: 'Bar', icon: '\u2581\u2583\u2585\u2587' },
  { value: 'area', label: 'Area', icon: '\u25E2' },
  { value: 'pie', label: 'Pie', icon: '\u25D4' },
  { value: 'scatter', label: 'Scatter', icon: '\u2022\u2022\u2022' },
  { value: 'stat', label: 'Stat', icon: '#' },
  { value: 'gauge', label: 'Gauge', icon: '\u25D1' },
  { value: 'table', label: 'Table', icon: '\u2637' },
];

const COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6',
  '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4',
];

interface ChartRendererProps {
  chartType: ChartType;
  columns: string[];
  rows: Record<string, unknown>[];
  config?: Record<string, unknown> | null;
}

function getNumericColumns(columns: string[], rows: Record<string, unknown>[]) {
  if (rows.length === 0) return [];
  return columns.filter((col) => {
    const val = rows[0][col];
    return typeof val === 'number' || (typeof val === 'string' && !isNaN(Number(val)));
  });
}

function coerceNumeric(rows: Record<string, unknown>[], cols: string[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out = { ...row };
    for (const col of cols) {
      const v = out[col];
      if (typeof v === 'string') out[col] = Number(v);
    }
    return out;
  });
}

const tooltipStyle = {
  contentStyle: {
    background: '#18181b',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    fontSize: 12,
    color: '#fafafa',
  },
};

export default function ChartRenderer({ chartType, columns, rows, config }: ChartRendererProps) {
  if (rows.length === 0) {
    return <div className="chart-empty">No data to visualize</div>;
  }

  const xCol = (config?.xColumn as string) || columns[0];
  const numericCols = getNumericColumns(columns, rows);
  const yColumns: string[] = (config?.yColumns as string[]) ||
    numericCols.filter((c) => c !== xCol).slice(0, 5);

  const data = coerceNumeric(rows, numericCols);

  switch (chartType) {
    case 'line':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey={xCol} tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
            <YAxis tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
            <Tooltip {...tooltipStyle} />
            {yColumns.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {yColumns.map((col, i) => (
              <Line key={col} type="monotone" dataKey={col} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={data.length <= 30} activeDot={{ r: 4 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );

    case 'bar':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey={xCol} tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
            <YAxis tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
            <Tooltip {...tooltipStyle} />
            {yColumns.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {yColumns.map((col, i) => (
              <Bar key={col} dataKey={col} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      );

    case 'area':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey={xCol} tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
            <YAxis tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
            <Tooltip {...tooltipStyle} />
            {yColumns.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {yColumns.map((col, i) => (
              <Area key={col} type="monotone" dataKey={col} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.15} strokeWidth={2} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      );

    case 'pie': {
      const valueCol = yColumns[0] || numericCols[0];
      const labelCol = xCol;
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey={valueCol}
              nameKey={labelCol}
              cx="50%"
              cy="50%"
              outerRadius="75%"
              innerRadius="40%"
              paddingAngle={2}
              label={(props: any) => `${props.name ?? ''} ${((props.percent ?? 0) * 100).toFixed(0)}%`}
              labelLine={{ stroke: '#71717a' }}
              fontSize={11}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip {...tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    case 'scatter': {
      const scatterX = xCol;
      const scatterY = yColumns[0] || numericCols.find((c) => c !== scatterX) || columns[1];
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey={scatterX} name={scatterX} tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} type="number" />
            <YAxis dataKey={scatterY} name={scatterY} tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} type="number" />
            <Tooltip {...tooltipStyle} />
            <Scatter data={data} fill={COLORS[0]} />
          </ScatterChart>
        </ResponsiveContainer>
      );
    }

    case 'stat': {
      const statCol = yColumns[0] || numericCols[0] || columns[0];
      const value = data[0]?.[statCol];
      const label = (config?.statLabel as string) || statCol;
      const formattedValue = typeof value === 'number'
        ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
        : String(value ?? '—');
      return (
        <div className="chart-stat">
          <div className="chart-stat-value">{formattedValue}</div>
          <div className="chart-stat-label">{label}</div>
          {data.length > 1 && (
            <div className="chart-stat-sub">{data.length} rows returned</div>
          )}
        </div>
      );
    }

    case 'gauge': {
      const gaugeCol = yColumns[0] || numericCols[0] || columns[0];
      const gaugeValue = Number(data[0]?.[gaugeCol]) || 0;
      const gaugeMin = Number(config?.gaugeMin ?? 0);
      const gaugeMax = Number(config?.gaugeMax ?? 100);
      const pct = Math.min(1, Math.max(0, (gaugeValue - gaugeMin) / (gaugeMax - gaugeMin)));
      const angle = pct * 180;
      const label = (config?.statLabel as string) || gaugeCol;

      // Thresholds for color
      let color = COLORS[0];
      if (pct > 0.8) color = '#ef4444';
      else if (pct > 0.6) color = '#f59e0b';

      return (
        <div className="chart-gauge">
          <svg viewBox="0 0 200 120" className="chart-gauge-svg">
            {/* Background arc */}
            <path
              d="M 20 100 A 80 80 0 0 1 180 100"
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="12"
              strokeLinecap="round"
            />
            {/* Value arc */}
            <path
              d={describeArc(100, 100, 80, 180, 180 + angle)}
              fill="none"
              stroke={color}
              strokeWidth="12"
              strokeLinecap="round"
            />
            <text x="100" y="88" textAnchor="middle" fill="#fafafa" fontSize="28" fontWeight="600">
              {gaugeValue.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </text>
            <text x="100" y="110" textAnchor="middle" fill="#71717a" fontSize="12">
              {label}
            </text>
          </svg>
        </div>
      );
    }

    case 'table':
      return (
        <div className="chart-table-container">
          <table className="data-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((row, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col} className={row[col] == null ? 'null-value' : ''}>
                      {row[col] == null ? 'NULL' : String(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    default:
      return <div className="chart-empty">Unknown chart type: {chartType}</div>;
  }
}

// Helper for SVG arc path
function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}
