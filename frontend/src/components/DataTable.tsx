interface Props {
  columns: string[];
  rows: Record<string, unknown>[];
  total?: number;
  limit?: number;
  offset?: number;
  onPageChange?: (offset: number) => void;
}

export default function DataTable({ columns, rows, total, limit = 100, offset = 0, onPageChange }: Props) {
  if (columns.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">{'{ }'}</div>
        <div className="empty-state-title">No results</div>
        <div className="empty-state-text">Run a query to see results here.</div>
      </div>
    );
  }

  const hasPagination = total !== undefined && total > limit;
  const page = Math.floor(offset / limit) + 1;
  const totalPages = total ? Math.ceil(total / limit) : 1;

  return (
    <div className="table-browser">
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => {
                  const val = row[col];
                  const isNull = val === null || val === undefined;
                  return (
                    <td key={col} className={isNull ? 'null-value' : ''}>
                      {isNull ? 'NULL' : String(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasPagination && onPageChange && (
        <div className="pagination">
          <span className="pagination-info">
            Showing {offset + 1}–{Math.min(offset + limit, total!)} of {total!.toLocaleString()}
          </span>
          <button className="btn btn-sm" disabled={offset === 0} onClick={() => onPageChange(Math.max(0, offset - limit))}>
            Previous
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Page {page} of {totalPages}
          </span>
          <button className="btn btn-sm" disabled={offset + limit >= total!} onClick={() => onPageChange(offset + limit)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
