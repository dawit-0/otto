export interface Database {
  id: string;
  name: string;
  path: string;
}

export interface Column {
  name: string;
  type: string;
  notnull: boolean;
  pk: boolean;
  default: string | null;
}

export interface ForeignKey {
  from_column: string;
  to_table: string;
  to_column: string;
}

export interface Index {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface TableInfo {
  name: string;
  columns: Column[];
  row_count: number;
  foreign_keys: ForeignKey[];
  indexes: Index[];
}

export interface SchemaResponse {
  tables: TableInfo[];
}

export interface TableDataResponse {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
}

export interface QueryResponse {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  message?: string;
}

export interface QueryHistoryEntry {
  id: number;
  db_id: string;
  db_name: string;
  sql: string;
  status: string;
  row_count: number | null;
  error_message: string | null;
  duration_ms: number | null;
  executed_at: string;
}

const BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  return res.json();
}

export const api = {
  connectDatabase: (path: string) =>
    request<Database>('/databases/connect', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  uploadDatabase: async (file: File): Promise<Database> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(BASE + '/databases/upload', { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Upload failed');
    }
    return res.json();
  },

  listDatabases: () => request<Database[]>('/databases'),

  disconnectDatabase: (id: string) =>
    request<{ ok: boolean }>(`/databases/${id}`, { method: 'DELETE' }),

  getSchema: (id: string) => request<SchemaResponse>(`/databases/${id}/schema`),

  getTableData: (id: string, table: string, limit = 100, offset = 0) =>
    request<TableDataResponse>(`/databases/${id}/tables/${table}/data?limit=${limit}&offset=${offset}`),

  executeQuery: (dbId: string, sql: string) =>
    request<QueryResponse>('/query', {
      method: 'POST',
      body: JSON.stringify({ db_id: dbId, sql }),
    }),

  getQueryHistory: (dbId?: string, limit = 50) => {
    const params = new URLSearchParams();
    if (dbId) params.set('db_id', dbId);
    params.set('limit', String(limit));
    return request<QueryHistoryEntry[]>(`/history?${params}`);
  },

  deleteHistoryEntry: (id: number) =>
    request<{ deleted: number }>(`/history/${id}`, { method: 'DELETE' }),

  clearHistory: (dbId?: string) => {
    const params = dbId ? `?db_id=${dbId}` : '';
    return request<{ deleted: number }>(`/history${params}`, { method: 'DELETE' });
  },
};
