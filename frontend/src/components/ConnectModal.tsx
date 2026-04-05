import { useState, useRef } from 'react';
import { api, type Database } from '../api';

interface Props {
  onConnect: (db: Database) => void;
  onClose: () => void;
}

export default function ConnectModal({ onConnect, onClose }: Props) {
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const connectByPath = async () => {
    if (!path.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const db = await api.connectDatabase(path.trim());
      onConnect(db);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const db = await api.uploadDatabase(file);
      onConnect(db);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') connectByPath();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Connect Database</div>

        <div className="modal-field">
          <label>File path</label>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="/path/to/database.db"
            autoFocus
          />
        </div>

        <div className="modal-divider">or</div>

        <div
          className="file-drop-zone"
          onClick={() => fileRef.current?.click()}
        >
          Click to upload a .db / .sqlite file
          <input
            ref={fileRef}
            type="file"
            accept=".db,.sqlite,.sqlite3"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }}
          />
        </div>

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 12 }}>{error}</div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={connectByPath} disabled={loading || !path.trim()}>
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
