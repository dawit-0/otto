import { useState, useRef } from 'react';
import { api, type Database } from '../api';

interface Props {
  onConnect: (db: Database) => void;
  onClose: () => void;
}

export default function ConnectModal({ onConnect, onClose }: Props) {
  const [dbType, setDbType] = useState<'sqlite' | 'postgres'>('sqlite');
  const [path, setPath] = useState('');
  const [pgHost, setPgHost] = useState('localhost');
  const [pgPort, setPgPort] = useState('5432');
  const [pgDatabase, setPgDatabase] = useState('');
  const [pgUsername, setPgUsername] = useState('');
  const [pgPassword, setPgPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const connectSqlite = async () => {
    if (!path.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const db = await api.connectDatabase({ db_type: 'sqlite', path: path.trim() });
      onConnect(db);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const connectPostgres = async () => {
    if (!pgDatabase.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const db = await api.connectDatabase({
        db_type: 'postgres',
        host: pgHost.trim(),
        port: parseInt(pgPort) || 5432,
        database: pgDatabase.trim(),
        username: pgUsername.trim() || undefined,
        password: pgPassword || undefined,
      });
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
    if (e.key === 'Enter') {
      if (dbType === 'sqlite') connectSqlite();
      else connectPostgres();
    }
    if (e.key === 'Escape') onClose();
  };

  const canConnect = dbType === 'sqlite' ? path.trim() !== '' : pgDatabase.trim() !== '';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Connect Database</div>

        <div className="connect-tabs">
          <button
            className={`connect-tab${dbType === 'sqlite' ? ' active' : ''}`}
            onClick={() => { setDbType('sqlite'); setError(null); }}
          >
            SQLite
          </button>
          <button
            className={`connect-tab${dbType === 'postgres' ? ' active' : ''}`}
            onClick={() => { setDbType('postgres'); setError(null); }}
          >
            PostgreSQL
          </button>
        </div>

        {dbType === 'sqlite' ? (
          <>
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
          </>
        ) : (
          <>
            <div className="modal-field-row">
              <div className="modal-field" style={{ flex: 2 }}>
                <label>Host</label>
                <input
                  type="text"
                  value={pgHost}
                  onChange={(e) => setPgHost(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="localhost"
                  autoFocus
                />
              </div>
              <div className="modal-field" style={{ flex: 1 }}>
                <label>Port</label>
                <input
                  type="text"
                  value={pgPort}
                  onChange={(e) => setPgPort(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="5432"
                />
              </div>
            </div>

            <div className="modal-field">
              <label>Database</label>
              <input
                type="text"
                value={pgDatabase}
                onChange={(e) => setPgDatabase(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="mydb"
              />
            </div>

            <div className="modal-field-row">
              <div className="modal-field" style={{ flex: 1 }}>
                <label>Username</label>
                <input
                  type="text"
                  value={pgUsername}
                  onChange={(e) => setPgUsername(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="postgres"
                />
              </div>
              <div className="modal-field" style={{ flex: 1 }}>
                <label>Password</label>
                <input
                  type="password"
                  value={pgPassword}
                  onChange={(e) => setPgPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="••••••••"
                />
              </div>
            </div>
          </>
        )}

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 12 }}>{error}</div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={dbType === 'sqlite' ? connectSqlite : connectPostgres}
            disabled={loading || !canConnect}
          >
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
