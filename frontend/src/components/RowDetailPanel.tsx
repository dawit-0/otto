import { useEffect, useRef, useState } from 'react';
import { type Column } from '../api';

interface Props {
  columns: string[];
  rows: Record<string, unknown>[];
  selectedIndex: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  columnDefs?: Column[];
  title?: string;
}

function formatValue(val: unknown): { display: string; isNull: boolean; isJson: boolean } {
  if (val === null || val === undefined) {
    return { display: '', isNull: true, isJson: false };
  }
  const s = String(val);
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try {
      return { display: JSON.stringify(JSON.parse(s), null, 2), isNull: false, isJson: true };
    } catch { /* not valid JSON */ }
  }
  return { display: s, isNull: false, isJson: false };
}

export default function RowDetailPanel({
  columns, rows, selectedIndex, onIndexChange, onClose, columnDefs, title,
}: Props) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const row = rows[selectedIndex];
  const total = rows.length;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (selectedIndex < total - 1) onIndexChange(selectedIndex + 1);
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (selectedIndex > 0) onIndexChange(selectedIndex - 1);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedIndex, total, onClose, onIndexChange]);

  const triggerCopy = (text: string, key: string | 'all') => {
    navigator.clipboard.writeText(text).then(() => {
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      if (key === 'all') {
        setCopiedAll(true);
        copyTimeout.current = setTimeout(() => setCopiedAll(false), 1500);
      } else {
        setCopiedField(key);
        copyTimeout.current = setTimeout(() => setCopiedField(null), 1500);
      }
    });
  };

  const copyField = (col: string, val: unknown) =>
    triggerCopy(val === null || val === undefined ? '' : String(val), col);

  const copyAll = () => {
    if (!row) return;
    const obj: Record<string, unknown> = {};
    columns.forEach((col) => { obj[col] = row[col] ?? null; });
    triggerCopy(JSON.stringify(obj, null, 2), 'all');
  };

  if (!row) return null;

  const getColDef = (colName: string) => columnDefs?.find((c) => c.name === colName);

  return (
    <div className="row-detail-panel">
      <div className="row-detail-header">
        <div className="row-detail-header-top">
          <div className="row-detail-title">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="row-detail-title-icon">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
            <span>Record</span>
            {title && <span className="row-detail-title-table">{title}</span>}
          </div>
          <button className="btn-icon row-detail-close" onClick={onClose} title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="row-detail-nav">
          <button
            className="btn-icon row-detail-nav-btn"
            onClick={() => onIndexChange(selectedIndex - 1)}
            disabled={selectedIndex === 0}
            title="Previous row (↑ or ←)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="row-detail-nav-pos">
            {selectedIndex + 1} <span className="row-detail-nav-of">of</span> {total}
          </span>
          <button
            className="btn-icon row-detail-nav-btn"
            onClick={() => onIndexChange(selectedIndex + 1)}
            disabled={selectedIndex >= total - 1}
            title="Next row (↓ or →)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          <button
            className={`btn btn-sm row-detail-copy-all${copiedAll ? ' btn-copy-success' : ''}`}
            onClick={copyAll}
            title="Copy record as JSON"
          >
            {copiedAll ? (
              <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> Copied</>
            ) : (
              <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg> Copy JSON</>
            )}
          </button>
        </div>
      </div>

      <div className="row-detail-body">
        {columns.map((col) => {
          const val = row[col];
          const { display, isNull, isJson } = formatValue(val);
          const def = getColDef(col);
          const isCopied = copiedField === col;

          return (
            <div key={col} className="row-detail-field">
              <div className="row-detail-field-header">
                <span className={`row-detail-col-name${def?.pk ? ' pk' : ''}`}>
                  {def?.pk && <span className="row-detail-pk-icon">🔑</span>}
                  {col}
                </span>
                {def?.type && <span className="row-detail-col-type">{def.type}</span>}
                <button
                  className={`btn-icon row-detail-copy-btn${isCopied ? ' copied' : ''}`}
                  onClick={() => copyField(col, val)}
                  title="Copy value"
                >
                  {isCopied ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  )}
                </button>
              </div>
              <div className={`row-detail-field-value${isNull ? ' is-null' : ''}${isJson ? ' is-json' : ''}`}>
                {isNull ? 'NULL' : display}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
