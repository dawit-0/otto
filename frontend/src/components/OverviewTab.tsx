import { useEffect, useState } from 'react';
import { api, type OverviewResponse, type OverviewTableSummary } from '../api';

interface Props {
  dbId: string;
  onSelectTable: (name: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function StatCard({
  label,
  value,
  sub,
  onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={`overview-stat-card${onClick ? ' overview-stat-card-clickable' : ''}`}
      onClick={onClick}
      title={onClick ? `View ${label.toLowerCase()}` : undefined}
    >
      <div className="overview-stat-value">{typeof value === 'number' ? formatNumber(value) : value}</div>
      <div className="overview-stat-label">{label}</div>
      {sub && <div className="overview-stat-sub">{sub}</div>}
    </div>
  );
}

function IndexesModal({
  tables,
  onClose,
}: {
  tables: OverviewTableSummary[];
  onClose: () => void;
}) {
  const tablesWithIndexes = tables.filter((t) => t.indexes.length > 0);
  const total = tablesWithIndexes.reduce((sum, t) => sum + t.indexes.length, 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Indexes ({total})</div>
        {tablesWithIndexes.length === 0 ? (
          <div className="overview-empty">No indexes defined in this database.</div>
        ) : (
          <div className="index-modal-list">
            {tablesWithIndexes.map((table) => (
              <div key={table.name} className="index-modal-group">
                <div className="index-modal-table">{table.name}</div>
                {table.indexes.map((idx) => (
                  <div key={idx.name} className="index-modal-row">
                    <span className="index-modal-icon">🔍</span>
                    <span className="index-modal-name">{idx.name}</span>
                    {idx.unique && <span className="index-modal-unique">UNIQUE</span>}
                    <span className="index-modal-cols">({idx.columns.join(', ')})</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function TableCard({
  table,
  maxRows,
  onSelect,
}: {
  table: OverviewTableSummary;
  maxRows: number;
  onSelect: () => void;
}) {
  const fillPct = maxRows > 0 ? Math.max(2, Math.round((table.row_count / maxRows) * 100)) : 0;

  return (
    <div className="overview-table-card" onClick={onSelect} title={`Browse ${table.name}`}>
      <div className="overview-table-card-header">
        <span className="overview-table-name">{table.name}</span>
        <span className="overview-table-rows">{formatNumber(table.row_count)} rows</span>
      </div>

      <div className="overview-table-bar-track">
        <div className="overview-table-bar-fill" style={{ width: `${fillPct}%` }} />
      </div>

      <div className="overview-table-meta">
        <span className="overview-table-badge">{table.column_count} cols</span>
        {table.index_count > 0 && (
          <span className="overview-table-badge">{table.index_count} idx</span>
        )}
        {table.fk_count > 0 && (
          <span className="overview-table-badge overview-table-badge-fk">
            {table.fk_count} FK
          </span>
        )}
        {table.has_pk && <span className="overview-table-badge overview-table-badge-pk">PK</span>}
      </div>

      <div className="overview-table-cols">
        {table.columns.slice(0, 6).map((col) => (
          <div key={col.name} className="overview-col-row">
            <span className={`overview-col-icon${col.pk ? ' pk' : ''}`}>
              {col.pk ? '🔑' : '·'}
            </span>
            <span className="overview-col-name">{col.name}</span>
            <span className="overview-col-type">{col.type}</span>
          </div>
        ))}
        {table.columns.length > 6 && (
          <div className="overview-col-more">+{table.columns.length - 6} more columns</div>
        )}
      </div>
    </div>
  );
}

export default function OverviewTab({ dbId, onSelectTable }: Props) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showIndexes, setShowIndexes] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getOverview(dbId)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [dbId]);

  if (loading) {
    return (
      <div className="overview-loading">
        <span>Loading overview…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="overview-loading">
        <span style={{ color: 'var(--danger)' }}>{error ?? 'Failed to load overview'}</span>
      </div>
    );
  }

  const maxRows = Math.max(...data.tables.map((t) => t.row_count), 1);

  return (
    <div className="overview-container">
      {/* DB info strip */}
      <div className="overview-db-strip">
        <div className="overview-db-strip-item">
          <span className="overview-db-strip-label">Path</span>
          <span className="overview-db-strip-value" title={data.db_info.path}>
            {data.db_info.path}
          </span>
        </div>
        <div className="overview-db-strip-item">
          <span className="overview-db-strip-label">Size</span>
          <span className="overview-db-strip-value">{formatBytes(data.db_info.file_size_bytes)}</span>
        </div>
        <div className="overview-db-strip-item">
          <span className="overview-db-strip-label">{data.db_info.db_type === 'postgres' ? 'PostgreSQL' : 'SQLite'}</span>
          <span className="overview-db-strip-value" title={data.db_info.db_version}>
            {data.db_info.db_type === 'postgres' ? data.db_info.db_version.split(' ')[0] + ' ' + data.db_info.db_version.split(' ')[1] : 'v' + data.db_info.db_version}
          </span>
        </div>
        {data.stats.view_count > 0 && (
          <div className="overview-db-strip-item">
            <span className="overview-db-strip-label">Views</span>
            <span className="overview-db-strip-value">{data.stats.view_count}</span>
          </div>
        )}
        {data.stats.trigger_count > 0 && (
          <div className="overview-db-strip-item">
            <span className="overview-db-strip-label">Triggers</span>
            <span className="overview-db-strip-value">{data.stats.trigger_count}</span>
          </div>
        )}
      </div>

      {/* Aggregate stat cards */}
      <div className="overview-stats-row">
        <StatCard label="Tables" value={data.stats.table_count} />
        <StatCard label="Total Rows" value={data.stats.total_rows} />
        <StatCard label="Columns" value={data.stats.total_columns} />
        <StatCard
          label="Indexes"
          value={data.stats.index_count}
          onClick={data.stats.index_count > 0 ? () => setShowIndexes(true) : undefined}
        />
      </div>

      {showIndexes && <IndexesModal tables={data.tables} onClose={() => setShowIndexes(false)} />}

      {/* Section header */}
      <div className="overview-section-header">
        <span className="overview-section-title">Tables</span>
        <span className="overview-section-hint">Click a table to browse its data</span>
      </div>

      {/* Table cards grid */}
      {data.tables.length === 0 ? (
        <div className="overview-empty">This database has no tables yet.</div>
      ) : (
        <div className="overview-tables-grid">
          {data.tables.map((table) => (
            <TableCard
              key={table.name}
              table={table}
              maxRows={maxRows}
              onSelect={() => onSelectTable(table.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
