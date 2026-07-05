import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from 'react';
import { api } from '../api';

type ColType = 'TEXT' | 'INTEGER' | 'REAL';

interface ParsedCSV {
  headers: string[];
  rows: string[][];
}

function parseCSV(text: string): ParsedCSV {
  const cleaned = text.startsWith('﻿') ? text.slice(1) : text;
  const allRows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  while (i < cleaned.length) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"' && cleaned[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && cleaned[i + 1] === '\n') i++;
        row.push(cell);
        cell = '';
        if (row.some(c => c !== '')) allRows.push(row);
        row = [];
      } else {
        cell += ch;
      }
    }
    i++;
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some(c => c !== '')) allRows.push(row);
  }

  if (allRows.length === 0) return { headers: [], rows: [] };
  return { headers: allRows[0], rows: allRows.slice(1) };
}

function inferTypes(headers: string[], rows: string[][]): ColType[] {
  const sample = rows.slice(0, 500);
  return headers.map((_, colIdx) => {
    const values = sample
      .map(r => r[colIdx]?.trim() ?? '')
      .filter(v => v !== '');
    if (values.length === 0) return 'TEXT';
    if (values.every(v => /^-?\d+$/.test(v))) return 'INTEGER';
    if (values.every(v => /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v))) return 'REAL';
    return 'TEXT';
  });
}

function toTableName(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/^(\d)/, '_$1')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'imported_data';
}

interface Props {
  dbId: string;
  onClose: () => void;
  onSuccess: (tableName: string) => void;
}

export default function ImportCSVModal({ dbId, onClose, onSuccess }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedCSV | null>(null);
  const [tableName, setTableName] = useState('');
  const [colTypes, setColTypes] = useState<ColType[]>([]);
  const [ifExists, setIfExists] = useState<'fail' | 'replace' | 'append'>('fail');
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ rows: number; table: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((f: File) => {
    setError(null);
    setSuccess(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const result = parseCSV(text);
      if (result.headers.length === 0) {
        setError('Could not parse CSV — make sure the file has a header row and at least one data row.');
        return;
      }
      setFile(f);
      setParsed(result);
      setTableName(toTableName(f.name));
      setColTypes(inferTypes(result.headers, result.rows));
    };
    reader.onerror = () => setError('Failed to read file.');
    reader.readAsText(f);
  }, []);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) processFile(dropped);
  };

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (picked) processFile(picked);
  };

  const handleImport = async () => {
    if (!file || !parsed || !tableName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const columnTypes = parsed.headers.map((name, i) => ({ name, type: colTypes[i] ?? 'TEXT' }));
      const result = await api.importCsv(dbId, file, tableName.trim(), columnTypes, ifExists);
      setSuccess({ rows: result.rows_imported, table: result.table });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDone = () => {
    if (success) onSuccess(success.table);
    else onClose();
  };

  const tableNameValid = /^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName.trim());

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-import" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="import-modal-header">
          <div className="import-modal-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Import CSV
          </div>
          <button className="btn-icon" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Success state */}
        {success ? (
          <div className="import-success">
            <div className="import-success-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="9 12 11 14 15 10" />
              </svg>
            </div>
            <div className="import-success-title">Import complete</div>
            <div className="import-success-body">
              <strong>{success.rows.toLocaleString()}</strong> row{success.rows !== 1 ? 's' : ''} imported
              into <code>{success.table}</code>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>Close</button>
              <button className="btn btn-primary" onClick={handleDone}>Open Table</button>
            </div>
          </div>
        ) : !parsed ? (
          /* Drop zone */
          <div
            className={`import-dropzone${dragging ? ' import-dropzone-active' : ''}`}
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onClick={() => fileRef.current?.click()}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <div className="import-dropzone-label">Drop a CSV file here</div>
            <div className="import-dropzone-sub">or click to browse</div>
            {error && <div className="import-error" style={{ marginTop: 12 }}>{error}</div>}
            <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleFileInput} />
          </div>
        ) : (
          /* Config form */
          <>
            <div className="import-file-info">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="import-file-name">{file!.name}</span>
              <span className="import-file-meta">
                {parsed.rows.length.toLocaleString()} row{parsed.rows.length !== 1 ? 's' : ''} · {parsed.headers.length} column{parsed.headers.length !== 1 ? 's' : ''}
              </span>
              <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { setFile(null); setParsed(null); setError(null); }}>
                Change
              </button>
            </div>

            <div className="modal-field">
              <label>Table name</label>
              <input
                value={tableName}
                onChange={e => setTableName(e.target.value)}
                placeholder="my_table"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
              {tableName && !tableNameValid && (
                <div className="import-field-hint import-field-hint-error">
                  Only letters, numbers, and underscores; must start with a letter or underscore.
                </div>
              )}
            </div>

            <div className="import-columns-section">
              <div className="import-columns-label">Column types</div>
              <div className="import-columns-list">
                {parsed.headers.map((header, i) => (
                  <div key={i} className="import-column-row">
                    <span className="import-column-name" title={header}>{header}</span>
                    <select
                      className="import-type-select"
                      value={colTypes[i] ?? 'TEXT'}
                      onChange={e => {
                        const next = [...colTypes];
                        next[i] = e.target.value as ColType;
                        setColTypes(next);
                      }}
                    >
                      <option value="TEXT">TEXT</option>
                      <option value="INTEGER">INTEGER</option>
                      <option value="REAL">REAL</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {parsed.rows.length > 0 && (
              <div className="import-preview-section">
                <div className="import-columns-label">Preview</div>
                <div className="import-preview-scroll">
                  <table className="import-preview-table">
                    <thead>
                      <tr>
                        {parsed.headers.map((h, i) => <th key={i}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.rows.slice(0, 4).map((row, ri) => (
                        <tr key={ri}>
                          {parsed.headers.map((_, ci) => (
                            <td key={ci}>{row[ci] ?? ''}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="import-exists-row">
              <span className="import-exists-label">If table exists:</span>
              {(['fail', 'replace', 'append'] as const).map(opt => (
                <label key={opt} className="import-radio-label">
                  <input
                    type="radio"
                    name="if_exists"
                    value={opt}
                    checked={ifExists === opt}
                    onChange={() => setIfExists(opt)}
                  />
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </label>
              ))}
            </div>

            {error && <div className="import-error">{error}</div>}

            <div className="modal-actions">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleImport}
                disabled={loading || !tableNameValid || !tableName.trim()}
              >
                {loading
                  ? 'Importing…'
                  : `Import ${parsed.rows.length.toLocaleString()} row${parsed.rows.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
