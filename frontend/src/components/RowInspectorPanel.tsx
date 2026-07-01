import { useEffect, useState } from 'react';
import { api, type RelatedRecordGroup } from '../api';

interface Props {
  dbId: string;
  tableName: string;
  row: Record<string, unknown>;
  onClose: () => void;
  onNavigate?: (table: string) => void;
}

function MiniTable({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  if (rows.length === 0) {
    return <div className="inspector-empty">No records found</div>;
  }
  return (
    <div className="inspector-mini-table-wrapper">
      <table className="inspector-mini-table">
        <thead>
          <tr>
            {columns.map((col) => <th key={col}>{col}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => {
                const val = row[col];
                const isNull = val === null || val === undefined;
                return (
                  <td key={col} className={isNull ? 'null-value' : ''}>
                    {isNull ? 'NULL' : String(val)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RelationSection({
  title,
  groups,
  onNavigate,
  badge,
}: {
  title: string;
  groups: RelatedRecordGroup[];
  onNavigate?: (table: string) => void;
  badge?: string;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (groups.length === 0) return null;

  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="inspector-section">
      <div className="inspector-section-header">
        <span className="inspector-section-title">{title}</span>
        {badge && <span className="inspector-section-badge">{badge}</span>}
      </div>
      <div className="inspector-relation-list">
        {groups.map((group, idx) => {
          const key = `${group.foreign_table}:${idx}`;
          const isOpen = expanded[key] !== false;
          const rowCount = group.rows.length;
          return (
            <div key={key} className="inspector-relation-item">
              <button
                className="inspector-relation-toggle"
                onClick={() => toggle(key)}
              >
                <svg
                  className={`inspector-chevron${isOpen ? ' open' : ''}`}
                  width="12" height="12" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span className="inspector-relation-table">{group.foreign_table}</span>
                <span className="inspector-relation-via">
                  via {group.local_column} → {group.foreign_column}
                </span>
                <span className="inspector-relation-count">
                  {rowCount}{group.has_more ? '+' : ''} row{rowCount !== 1 ? 's' : ''}
                </span>
                {onNavigate && (
                  <button
                    className="inspector-jump-btn"
                    title={`Browse ${group.foreign_table}`}
                    onClick={(e) => { e.stopPropagation(); onNavigate(group.foreign_table); }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </button>
                )}
              </button>
              {isOpen && (
                <MiniTable columns={group.columns} rows={group.rows} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function RowInspectorPanel({ dbId, tableName, row, onClose, onNavigate }: Props) {
  const [parents, setParents] = useState<RelatedRecordGroup[]>([]);
  const [children, setChildren] = useState<RelatedRecordGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'parents' | 'children'>('overview');

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.getRelatedRecords(dbId, tableName, row)
      .then((data) => {
        setParents(data.parents);
        setChildren(data.children);
        setActiveTab(data.parents.length > 0 ? 'parents' : data.children.length > 0 ? 'children' : 'overview');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load related records'))
      .finally(() => setLoading(false));
  }, [dbId, tableName, row]);

  const hasRelations = parents.length > 0 || children.length > 0;

  return (
    <div className="row-inspector-panel">
      <div className="row-inspector-header">
        <div className="row-inspector-header-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span className="row-inspector-title">Row Inspector</span>
          <span className="row-inspector-subtitle">{tableName}</span>

          <div className="row-inspector-tabs">
            <button
              className={`row-inspector-tab${activeTab === 'overview' ? ' active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              Values
            </button>
            <button
              className={`row-inspector-tab${activeTab === 'parents' ? ' active' : ''}`}
              onClick={() => setActiveTab('parents')}
              disabled={!hasRelations && !loading}
            >
              Parents
              {parents.length > 0 && <span className="row-inspector-tab-badge">{parents.length}</span>}
            </button>
            <button
              className={`row-inspector-tab${activeTab === 'children' ? ' active' : ''}`}
              onClick={() => setActiveTab('children')}
              disabled={!hasRelations && !loading}
            >
              Children
              {children.length > 0 && <span className="row-inspector-tab-badge">{children.length}</span>}
            </button>
          </div>
        </div>

        <button className="row-inspector-close" onClick={onClose} title="Close inspector">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="row-inspector-body">
        {activeTab === 'overview' && (
          <div className="inspector-overview-grid">
            {Object.entries(row).map(([col, val]) => {
              const isNull = val === null || val === undefined;
              return (
                <div key={col} className="inspector-kv">
                  <span className="inspector-kv-key">{col}</span>
                  <span className={`inspector-kv-val${isNull ? ' null-value' : ''}`}>
                    {isNull ? 'NULL' : String(val)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'parents' && (
          <>
            {loading && <div className="inspector-loading">Loading…</div>}
            {error && <div className="inspector-error">{error}</div>}
            {!loading && !error && parents.length === 0 && (
              <div className="inspector-empty-state">No parent relationships defined for this table.</div>
            )}
            {!loading && !error && (
              <RelationSection
                title="Referenced by this row"
                groups={parents}
                onNavigate={onNavigate}
              />
            )}
          </>
        )}

        {activeTab === 'children' && (
          <>
            {loading && <div className="inspector-loading">Loading…</div>}
            {error && <div className="inspector-error">{error}</div>}
            {!loading && !error && children.length === 0 && (
              <div className="inspector-empty-state">No other tables reference this table.</div>
            )}
            {!loading && !error && (
              <RelationSection
                title="Rows referencing this record"
                groups={children}
                onNavigate={onNavigate}
                badge={children.reduce((acc, g) => acc + g.rows.length, 0).toString()}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
