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

export interface SavedVisualization {
  id: number;
  db_id: string;
  db_name: string;
  title: string;
  sql: string;
  chart_type: string;
  config: Record<string, unknown> | null;
  grid_x: number;
  grid_y: number;
  grid_w: number;
  grid_h: number;
  created_at: string;
  updated_at: string;
}

export interface VisualizationHistoryEntry {
  id: number;
  db_id: string;
  db_name: string;
  title: string | null;
  sql: string;
  chart_type: string;
  config: Record<string, unknown> | null;
  row_count: number | null;
  duration_ms: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

export interface VisualizationRunResponse {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
}

export interface SavedQueryEntry {
  id: number;
  db_id: string;
  db_name: string;
  name: string;
  sql: string;
  description: string | null;
  created_at: string;
  updated_at: string;
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

  // ── Visualizations ──

  runVisualization: (dbId: string, sql: string, chartType: string, title?: string, config?: Record<string, unknown>) =>
    request<VisualizationRunResponse>('/visualizations/run', {
      method: 'POST',
      body: JSON.stringify({ db_id: dbId, sql, chart_type: chartType, title, config }),
    }),

  listVisualizations: (dbId?: string) => {
    const params = dbId ? `?db_id=${dbId}` : '';
    return request<SavedVisualization[]>(`/visualizations${params}`);
  },

  saveVisualization: (data: {
    db_id: string; db_name: string; title: string; sql: string;
    chart_type: string; config?: Record<string, unknown> | null;
    grid_x?: number; grid_y?: number; grid_w?: number; grid_h?: number;
  }) =>
    request<SavedVisualization>('/visualizations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateVisualization: (id: number, data: Record<string, unknown>) =>
    request<SavedVisualization>(`/visualizations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteVisualization: (id: number) =>
    request<{ deleted: number }>(`/visualizations/${id}`, { method: 'DELETE' }),

  updateVisualizationLayout: (panels: { id: number; grid_x: number; grid_y: number; grid_w: number; grid_h: number }[]) =>
    request<{ ok: boolean }>('/visualizations/layout/batch', {
      method: 'PUT',
      body: JSON.stringify({ panels }),
    }),

  getVisualizationHistory: (dbId?: string, limit = 50) => {
    const params = new URLSearchParams();
    if (dbId) params.set('db_id', dbId);
    params.set('limit', String(limit));
    return request<VisualizationHistoryEntry[]>(`/visualizations/history?${params}`);
  },

  clearVisualizationHistory: (dbId?: string) => {
    const params = dbId ? `?db_id=${dbId}` : '';
    return request<{ deleted: number }>(`/visualizations/history${params}`, { method: 'DELETE' });
  },

  deleteVisualizationHistoryEntry: (id: number) =>
    request<{ deleted: number }>(`/visualizations/history/${id}`, { method: 'DELETE' }),

  // ── Saved Queries ──

  listSavedQueries: (dbId?: string) => {
    const params = dbId ? `?db_id=${dbId}` : '';
    return request<SavedQueryEntry[]>(`/saved-queries${params}`);
  },

  saveQuery: (data: { db_id: string; db_name: string; name: string; sql: string; description?: string }) =>
    request<SavedQueryEntry>('/saved-queries', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateSavedQuery: (id: number, data: { name?: string; sql?: string; description?: string }) =>
    request<SavedQueryEntry>(`/saved-queries/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteSavedQuery: (id: number) =>
    request<{ deleted: number }>(`/saved-queries/${id}`, { method: 'DELETE' }),

  // ── AI ──

  generateAiQuery: (dbId: string, prompt: string) =>
    request<{ sql: string }>('/ai/generate-query', {
      method: 'POST',
      body: JSON.stringify({ db_id: dbId, prompt }),
    }),

  askOtto: (dbId: string, question: string) =>
    request<{
      sql: string;
      explanation: string;
      columns: string[];
      rows: Record<string, unknown>[];
      row_count: number;
    }>('/ai/ask', {
      method: 'POST',
      body: JSON.stringify({ db_id: dbId, question }),
    }),
};
