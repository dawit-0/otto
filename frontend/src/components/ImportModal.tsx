import { useState, useRef, useCallback } from 'react';
import { api, type ImportPreviewResponse } from '../api';

type ColType = 'TEXT' | 'INTEGER' | 'REAL';
type IfExists = 'fail' | 'replace' | 'append';

interface Props {
  dbId: string;
  onClose: () => void;
  onImportComplete: (tableName: string) => void;
}

const TYPE_CYCLE: ColType[] = ['TEXT', 'INTEGER', 'REAL'];
const TYPE_LABELS: Record<ColType, string> = { TEXT: 'TEXT', INTEGER: 'INT', REAL: 'REAL' };

export default function ImportModal({ dbId, onClose, onImportComplete }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [tableName, setTableName] = useState('');
  const [ifExists, setIfExists] = useState<IfExists>('fail');
  const [columnTypes, setColumnTypes] = useState<Record<string, ColType>>({});

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<{ tableName: string; rowsImported: number } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const loadPreview = useCallback(async (f: File) => {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    setResult(null);
    try {
      const data = await api.importPreview(dbId, f);
      setPreview(data);
      setTableName(data.default_table_name);
      const types: Record<string, ColType> = {};
      for (const col of data.columns) types[col.original_name] = col.inferred_type;
      setColumnTypes(types);
    } catch (e: any) {
      setPreviewError(e.message);
    } finally {
      setPreviewLoading(false);
    }
  }, [dbId]);

  const handleFile = (f: File) => {
    setFile(f);
    loadPreview(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const cycleType = (originalName: string) => {
    setColumnTypes(prev => {
      const cur = prev[originalName] ?? 'TEXT';
      const idx = TYPE_CYCLE.indexOf(cur);
      return { ...prev, [originalName]: TYPE_CYCLE[(idx + 1) % TYPE_CYCLE.length] };
    });
  };

  const handleImport = async () => {
    if (!file || !preview || !tableName.trim()) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await api.importExecute(dbId, file, tableName.trim(), ifExists, columnTypes);
      setResult({ tableName: res.table_name, rowsImported: res.rows_imported });
    } catch (e: any) {
      setImportError(e.message);
    } finally {
      setImporting(false);
    }
  };

  const tableNameValid = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName.trim());

  if (result) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal import-modal" onClick={e => e.stopPropagation()}>
          <div className="import-success">
            <div className="import-success-icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="9 12 11 14 15 10" />
              </svg>
            </div>
            <div className="import-success-title">Import complete</div>
            <div className="import-success-detail">
              {result.rowsImported.toLocaleString()} row{result.rowsImported !== 1 ? 's' : ''} imported into <strong>{result.tableName}</strong>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => { setResult(null); setFile(null); setPreview(null); }}>
              Import Another
            </button>
            <button className="btn btn-primary" onClick={() => onImportComplete(result.tableName)}>
              View Table
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal import-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Import Data</div>

        {!file ? (
          <div
            className={`file-drop-zone import-drop-zone${dragging ? ' dragging' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <div className="import-drop-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div className="import-drop-label">Drop a CSV or JSON file here</div>
            <div className="import-drop-sub">or click to browse</div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.json"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>
        ) : (
          <>
            <div className="import-file-bar">
              <div className="import-file-info">
                <span className="import-file-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </span>
                <span className="import-file-name">{file.name}</span>
                {preview && (
                  <span className="import-file-meta">
                    {preview.format.toUpperCase()} · {preview.total_rows.toLocaleString()} rows · {preview.columns.length} cols
                  </span>
                )}
              </div>
              <button
                className="btn-icon"
                onClick={() => { setFile(null); setPreview(null); setPreviewError(null); if (fileRef.current) fileRef.current.value = ''; }}
                title="Remove file"
              >
                &#x2715;
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.json"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>

            {previewLoading && (
              <div className="import-loading">Parsing file…</div>
            )}

            {previewError && (
              <div className="import-error">{previewError}</div>
            )}

            {preview && (
              <>
                <div className="import-section-row">
                  <div className="modal-field" style={{ flex: 1, marginBottom: 0 }}>
                    <label>Table name</label>
                    <input
                      type="text"
                      value={tableName}
                      onChange={e => setTableName(e.target.value)}
                      placeholder="table_name"
                      autoFocus
                    />
                    {tableName && !tableNameValid && (
                      <div className="import-field-hint">Use letters, digits, underscores only</div>
                    )}
                  </div>
                  <div className="modal-field" style={{ flex: '0 0 auto', minWidth: 120, marginBottom: 0 }}>
                    <label>If table exists</label>
                    <select
                      className="import-select"
                      value={ifExists}
                      onChange={e => setIfExists(e.target.value as IfExists)}
                    >
                      <option value="fail">Fail</option>
                      <option value="replace">Replace</option>
                      <option value="append">Append</option>
                    </select>
                  </div>
                </div>

                <div className="import-columns-header">
                  <span>Columns</span>
                  <span className="import-columns-hint">Click type badge to change</span>
                </div>
                <div className="import-columns-list">
                  {preview.columns.map(col => (
                    <div key={col.original_name} className="import-col-row">
                      <span className="import-col-name" title={col.original_name}>
                        {col.name !== col.original_name ? (
                          <>
                            <span>{col.name}</span>
                            <span className="import-col-original">{col.original_name}</span>
                          </>
                        ) : col.name}
                      </span>
                      <button
                        className={`import-type-badge import-type-${(columnTypes[col.original_name] ?? col.inferred_type).toLowerCase()}`}
                        onClick={() => cycleType(col.original_name)}
                        title="Click to cycle: TEXT → INT → REAL"
                      >
                        {TYPE_LABELS[columnTypes[col.original_name] ?? col.inferred_type]}
                      </button>
                    </div>
                  ))}
                </div>

                {preview.preview.length > 0 && (
                  <>
                    <div className="import-preview-header">
                      Preview <span className="import-preview-count">(first {preview.preview.length} of {preview.total_rows.toLocaleString()})</span>
                    </div>
                    <div className="import-preview-scroll">
                      <table className="import-preview-table">
                        <thead>
                          <tr>
                            {preview.columns.map(col => (
                              <th key={col.original_name}>{col.name}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.preview.map((row, i) => (
                            <tr key={i}>
                              {preview.columns.map(col => (
                                <td key={col.original_name}>
                                  {row[col.original_name] ?? <span className="import-null">null</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {importError && (
          <div className="import-error" style={{ marginTop: 12 }}>{importError}</div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          {preview && (
            <button
              className="btn btn-primary"
              onClick={handleImport}
              disabled={importing || !tableNameValid || !file}
            >
              {importing ? 'Importing…' : `Import ${preview.total_rows.toLocaleString()} rows`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
