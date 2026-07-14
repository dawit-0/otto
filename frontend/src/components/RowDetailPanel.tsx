import { useState } from 'react';
import { api, type Column, type ForeignKey, type TableInfo, type FilterRule } from '../api';

// ── Incoming Ref Section ──────────────────────────────────────────────────────

interface IncomingRefSectionProps {
  dbId: string;
  fromTable: string;
  fromColumn: string;
  pkValue: string;
  onNavigateTo: (tableName: string, filterCol: string, filterVal: string) => void;
}

function IncomingRefSection({ dbId, fromTable, fromColumn, pkValue, onNavigateTo }: IncomingRefSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const filter: FilterRule = { id: 'ref', column: fromColumn, op: 'equals', value: pkValue };
      const result = await api.getTableData(dbId, fromTable, 5, 0, undefined, undefined, [filter]);
      setColumns(result.columns);
      setRows(result.rows);
      setTotal(result.total);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    if (!expanded && rows === null) load();
    setExpanded(v => !v);
  };

  const previewCols = columns.slice(0, 4);

  return (
    <div className="incoming-ref-section">
      <button className="incoming-ref-header" onClick={toggle}>
        <span className="incoming-ref-chevron">{expanded ? '▾' : '▸'}</span>
        <span className="incoming-ref-table-name">{fromTable}</span>
        {total > 0 && <span className="incoming-ref-count">{total.toLocaleString()}</span>}
      </button>

      {expanded && (
        <div className="incoming-ref-content">
          {loading && <div className="incoming-ref-loading">Loading…</div>}

          {!loading && rows !== null && rows.length === 0 && (
            <div className="incoming-ref-empty">No matching records</div>
          )}

          {!loading && rows !== null && rows.length > 0 && (
            <>
              <div className="incoming-ref-table-scroll">
                <table className="incoming-ref-table">
                  <thead>
                    <tr>
                      {previewCols.map(c => <th key={c}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i}>
                        {previewCols.map(c => {
                          const v = row[c];
                          const isNull = v === null || v === undefined;
                          return (
                            <td key={c} className={isNull ? 'null-value' : ''}>
                              {isNull ? 'NULL' : String(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="incoming-ref-view-all"
                onClick={() => onNavigateTo(fromTable, fromColumn, pkValue)}
              >
                View all {total.toLocaleString()} rows in Data tab →
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Value formatting ──────────────────────────────────────────────────────────

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.length > 600) return s.slice(0, 600) + '…';
  if ((s.startsWith('{') || s.startsWith('[')) && s.length < 2000) {
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch { /* not JSON */ }
  }
  return s;
}

function isJsonLike(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  const s = val.trim();
  if (!((s.startsWith('{') || s.startsWith('[')) && s.length < 2000)) return false;
  try { JSON.parse(s); return true; } catch { return false; }
}

// ── RowDetailPanel ────────────────────────────────────────────────────────────

interface Props {
  row: Record<string, unknown>;
  tableName: string;
  columnDefs: Column[];
  foreignKeys: ForeignKey[];
  allTables: TableInfo[];
  dbId: string;
  onClose: () => void;
  onNavigateTo: (tableName: string, filterCol: string, filterVal: string) => void;
}

export default function RowDetailPanel({
  row,
  tableName,
  columnDefs,
  foreignKeys,
  allTables,
  dbId,
  onClose,
  onNavigateTo,
}: Props) {
  const pkCol = columnDefs.find(c => c.pk);
  const pkValue = pkCol ? row[pkCol.name] : null;

  const incomingRefs = allTables
    .filter(t => t.name !== tableName)
    .flatMap(t =>
      t.foreign_keys
        .filter(fk => fk.to_table === tableName && (!pkCol || fk.to_column === pkCol.name))
        .map(fk => ({ fromTable: t.name, fromColumn: fk.from_column }))
    );

  return (
    <div className="row-detail-panel">
      {/* Header */}
      <div className="row-detail-header">
        <div className="row-detail-header-info">
          <span className="row-detail-table-name">{tableName}</span>
          {pkCol && pkValue !== null && pkValue !== undefined && (
            <span className="row-detail-pk-badge">
              {pkCol.name}: {String(pkValue)}
            </span>
          )}
        </div>
        <button className="btn-icon" onClick={onClose} title="Close panel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="row-detail-body">
        {/* Fields */}
        <div className="row-detail-section">
          <div className="row-detail-section-label">Fields</div>
          <div className="row-detail-fields">
            {columnDefs.map(col => {
              const val = row[col.name];
              const isNull = val === null || val === undefined;
              const fk = foreignKeys.find(f => f.from_column === col.name);
              const isJson = !isNull && isJsonLike(val);

              return (
                <div key={col.name} className="row-detail-field">
                  <div className="row-detail-field-meta">
                    <span className="row-detail-field-name">{col.name}</span>
                    <div className="row-detail-field-tags">
                      {col.pk && <span className="rdp-tag rdp-tag-pk">PK</span>}
                      {fk && <span className="rdp-tag rdp-tag-fk">FK</span>}
                      <span className="rdp-tag rdp-tag-type">{col.type || 'ANY'}</span>
                    </div>
                  </div>

                  <div className={`row-detail-field-value${isNull ? ' rdp-null-cell' : ''}${isJson ? ' rdp-json-cell' : ''}`}>
                    {isNull
                      ? <span className="rdp-null">NULL</span>
                      : <span className="rdp-value">{formatValue(val)}</span>
                    }
                  </div>

                  {fk && !isNull && (
                    <button
                      className="rdp-fk-link"
                      onClick={() => onNavigateTo(fk.to_table, fk.to_column, String(val))}
                      title={`Go to ${fk.to_table} where ${fk.to_column} = ${String(val)}`}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                      {fk.to_table}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Referenced by */}
        {incomingRefs.length > 0 && pkValue !== null && pkValue !== undefined && (
          <div className="row-detail-section">
            <div className="row-detail-section-label">Referenced by</div>
            <div className="incoming-refs-list">
              {incomingRefs.map(ref => (
                <IncomingRefSection
                  key={`${ref.fromTable}.${ref.fromColumn}`}
                  dbId={dbId}
                  fromTable={ref.fromTable}
                  fromColumn={ref.fromColumn}
                  pkValue={String(pkValue)}
                  onNavigateTo={onNavigateTo}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
