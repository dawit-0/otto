import { useState } from 'react';
import { type Column } from '../api';

interface Props {
  tableName: string;
  columnDefs: Column[];
  onInsert: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

function inferInputType(colType: string): 'number' | 'text' {
  const t = colType.toLowerCase();
  if (t.includes('int') || t.includes('real') || t.includes('float') ||
      t.includes('double') || t.includes('numeric') || t.includes('decimal') ||
      t.includes('number') || t.includes('serial')) return 'number';
  return 'text';
}

export default function AddRowModal({ tableName, columnDefs, onInsert, onClose }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    columnDefs.forEach((col) => {
      init[col.name] = '';
    });
    return init;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setValue = (col: string, val: string) =>
    setValues((prev) => ({ ...prev, [col]: val }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const data: Record<string, unknown> = {};
    columnDefs.forEach((col) => {
      const v = values[col.name];
      if (v !== '') {
        data[col.name] = v;
      }
    });

    setLoading(true);
    try {
      await onInsert(data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Insert failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal add-row-modal">
        <div className="add-row-modal-header">
          <h2 className="modal-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Insert row into <code>{tableName}</code>
          </h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {error && (
          <div className="add-row-error">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="add-row-form">
          <div className="add-row-fields">
            {columnDefs.map((col) => {
              const isPk = col.pk;
              const isRequired = col.notnull && col.default === null && !isPk;
              const inputType = inferInputType(col.type || '');

              return (
                <div key={col.name} className="add-row-field">
                  <label className="add-row-label">
                    {col.name}
                    {isPk && <span className="add-row-badge add-row-badge-pk">PK</span>}
                    {isRequired && <span className="add-row-required">*</span>}
                    <span className="add-row-type">{col.type || 'ANY'}</span>
                  </label>
                  <input
                    type={inputType}
                    className="add-row-input"
                    value={values[col.name]}
                    onChange={(e) => setValue(col.name, e.target.value)}
                    placeholder={
                      isPk ? 'auto (leave blank for default)'
                      : col.default !== null ? `default: ${col.default}`
                      : isRequired ? 'required'
                      : 'optional (NULL if blank)'
                    }
                    required={isRequired}
                  />
                </div>
              );
            })}
          </div>

          <div className="add-row-footer">
            <span className="add-row-hint">
              * Required fields · Leave others blank to use column defaults
            </span>
            <div className="modal-actions" style={{ marginTop: 0 }}>
              <button type="button" className="btn" onClick={onClose} disabled={loading}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="spin">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                    </svg>
                    Inserting…
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Insert Row
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
