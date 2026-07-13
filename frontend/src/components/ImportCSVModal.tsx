import { useState, useRef, useCallback, useEffect } from 'react';
import { api } from '../api';

interface ColDef {
  name: string;
  type: 'TEXT' | 'INTEGER' | 'REAL';
}

interface CSVPreview {
  columns: ColDef[];
  rows: Record<string, string>[];
  totalRows: number;
}

interface Props {
  dbId: string;
  onImported: (tableName: string, rowCount: number) => void;
  onClose: () => void;
}

// ── Client-side CSV parser ────────────────────────────────────────────────────

function inferType(values: string[]): 'TEXT' | 'INTEGER' | 'REAL' {
  const nonEmpty = values.filter((v) => v.trim() !== '');
  if (!nonEmpty.length) return 'TEXT';
  if (nonEmpty.every((v) => /^-?\d+$/.test(v.trim()))) return 'INTEGER';
  if (nonEmpty.every((v) => /^-?\d*\.?\d+([eE][+-]?\d+)?$/.test(v.trim()))) return 'REAL';
  return 'TEXT';
}

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  // Remove BOM if present
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return { headers: [], rows: [] };

  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { field += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { result.push(field); field = ''; }
        else { field += ch; }
      }
    }
    result.push(field);
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(parseRow);
  return { headers, rows };
}

function buildPreview(file: File): Promise<CSVPreview> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = (e.target?.result as string) ?? '';
        const { headers, rows } = parseCSV(text);
        if (!headers.length) { reject(new Error('No columns found in CSV')); return; }
        const columns: ColDef[] = headers.map((name, i) => ({
          name,
          type: inferType(rows.map((r) => r[i] ?? '')),
        }));
        const previewRecords = rows.slice(0, 5).map((r) =>
          Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))
        );
        resolve({ columns, rows: previewRecords, totalRows: rows.length });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file, 'utf-8');
  });
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ImportCSVModal({ dbId, onImported, onClose }: Props) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CSVPreview | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [tableName, setTableName] = useState('');
  const [ifExists, setIfExists] = useState<'fail' | 'replace' | 'append'>('fail');
  const [colTypes, setColTypes] = useState<Record<string, 'TEXT' | 'INTEGER' | 'REAL'>>({});
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (f: File) => {
    if (!f.name.match(/\.(csv|tsv|txt)$/i) && f.type !== 'text/csv') {
      setParseError('Please select a CSV file (.csv)');
      return;
    }
    setFile(f);
    setParseError(null);
    setImportError(null);
    setTableName(f.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_'));
    try {
      const p = await buildPreview(f);
      setPreview(p);
      setColTypes(Object.fromEntries(p.columns.map((c) => [c.name, c.type])));
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse CSV');
      setPreview(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleImport = async () => {
    if (!file || !preview || !tableName.trim()) return;
    setImporting(true);
    setImportError(null);
    try {
      const result = await api.importCSV(dbId, file, tableName.trim(), ifExists);
      onImported(result.table, result.rows_imported);
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const typeLabel: Record<string, string> = { TEXT: 'Text', INTEGER: 'Integer', REAL: 'Real' };
  const canImport = !!file && !!preview && tableName.trim().length > 0 && !importing;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal csv-import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Import CSV</div>
        <p className="csv-import-subtitle">
          Create a new table from a CSV file. Column types are inferred automatically.
        </p>

        {/* Drop zone */}
        {!file ? (
          <div
            className={`csv-drop-zone${dragging ? ' dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <div className="csv-drop-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <polyline points="9 15 12 12 15 15" />
              </svg>
            </div>
            <div className="csv-drop-text">Drop a CSV file here</div>
            <div className="csv-drop-hint">or click to browse</div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>
        ) : (
          <div className="csv-file-selected">
            <div className="csv-file-info">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="csv-file-name">{file.name}</span>
              {preview && (
                <span className="csv-file-meta">
                  {preview.totalRows.toLocaleString()} row{preview.totalRows !== 1 ? 's' : ''} · {preview.columns.length} column{preview.columns.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <button
              className="btn-icon"
              onClick={() => { setFile(null); setPreview(null); setParseError(null); setImportError(null); }}
              title="Choose different file"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {parseError && (
          <div className="csv-error">{parseError}</div>
        )}

        {preview && (
          <>
            {/* Table name + if_exists */}
            <div className="modal-field-row" style={{ marginTop: 16 }}>
              <div className="modal-field" style={{ flex: 2 }}>
                <label>Table name</label>
                <input
                  type="text"
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  placeholder="my_table"
                  autoFocus
                />
              </div>
              <div className="modal-field" style={{ flex: 1 }}>
                <label>If table exists</label>
                <select
                  className="csv-select"
                  value={ifExists}
                  onChange={(e) => setIfExists(e.target.value as typeof ifExists)}
                >
                  <option value="fail">Fail</option>
                  <option value="replace">Replace</option>
                  <option value="append">Append</option>
                </select>
              </div>
            </div>

            {/* Column types */}
            <div className="csv-columns-section">
              <div className="csv-columns-label">Detected columns</div>
              <div className="csv-columns-list">
                {preview.columns.map((col) => (
                  <div key={col.name} className="csv-column-row">
                    <span className="csv-column-name" title={col.name}>{col.name}</span>
                    <select
                      className="csv-type-select"
                      value={colTypes[col.name] ?? col.type}
                      onChange={(e) =>
                        setColTypes((prev) => ({ ...prev, [col.name]: e.target.value as ColDef['type'] }))
                      }
                    >
                      {(['TEXT', 'INTEGER', 'REAL'] as const).map((t) => (
                        <option key={t} value={t}>{typeLabel[t]}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Data preview */}
            <div className="csv-preview-section">
              <div className="csv-preview-label">
                Preview <span className="csv-preview-count">(first {preview.rows.length} of {preview.totalRows.toLocaleString()} rows)</span>
              </div>
              <div className="csv-preview-table-wrap">
                <table className="csv-preview-table">
                  <thead>
                    <tr>
                      {preview.columns.map((c) => (
                        <th key={c.name}>{c.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i}>
                        {preview.columns.map((c) => (
                          <td key={c.name}>{row[c.name] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {importError && (
          <div className="csv-error" style={{ marginTop: 12 }}>{importError}</div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleImport}
            disabled={!canImport}
          >
            {importing ? 'Importing…' : `Import${preview ? ` ${preview.totalRows.toLocaleString()} rows` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
