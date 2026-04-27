import { useState, useEffect, useRef, useCallback } from 'react';
import { api, type SearchResponse, type SearchTableResult } from '../api';

interface Props {
  dbId: string;
  dbName: string;
  onNavigateToTable: (tableName: string) => void;
  autoFocusTrigger?: number;
}

function highlight(text: string, query: string) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function TableResultGroup({
  result,
  query,
  onNavigate,
}: {
  result: SearchTableResult;
  query: string;
  onNavigate: (table: string) => void;
}) {
  return (
    <div className="search-result-group">
      <div className="search-result-group-header">
        <span className="search-result-table-icon">&#9632;</span>
        <span className="search-result-table-name">{result.table}</span>
        <span className="search-result-count-badge">
          {result.match_count.toLocaleString()}{' '}
          {result.match_count === 1 ? 'match' : 'matches'}
        </span>
        <button
          className="btn btn-sm"
          onClick={() => onNavigate(result.table)}
          style={{ marginLeft: 'auto' }}
        >
          Open table
        </button>
      </div>

      <div className="search-result-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              {result.columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i} className="search-result-row">
                {result.columns.map((col) => {
                  const val = row[col];
                  const isNull = val === null || val === undefined;
                  const strVal = isNull ? '' : String(val);
                  const matched = strVal.toLowerCase().includes(query.toLowerCase());
                  return (
                    <td key={col} className={isNull ? 'null-value' : ''}>
                      {isNull ? 'NULL' : matched ? highlight(strVal, query) : strVal}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {result.match_count > result.showing && (
          <div className="search-result-overflow">
            <span>
              Showing {result.showing} of {result.match_count.toLocaleString()} matches
            </span>
            <button className="search-result-overflow-link" onClick={() => onNavigate(result.table)}>
              View all in Data tab &#8594;
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SearchView({ dbId, dbName, onNavigateToTable, autoFocusTrigger }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [autoFocusTrigger]);

  const performSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults(null);
        setError(null);
        return;
      }

      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();

      setLoading(true);
      setError(null);
      try {
        const data = await api.searchDatabase(dbId, q.trim());
        setResults(data);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError((e as Error).message);
          setResults(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [dbId]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => performSearch(q), 350);
  };

  const handleClear = () => {
    setQuery('');
    setResults(null);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    inputRef.current?.focus();
  };

  const hasResults = results && results.results.length > 0;
  const noResults = results && results.results.length === 0 && query.trim();

  return (
    <div className="search-view">
      <div className="search-header">
        <div className="search-input-wrapper">
          <span className="search-icon">&#9906;</span>
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            placeholder={`Search all tables in ${dbName}…`}
            value={query}
            onChange={handleChange}
            autoComplete="off"
            spellCheck={false}
          />
          {loading && <span className="search-spinner" aria-label="Searching">&#8635;</span>}
          {query && !loading && (
            <button className="btn-icon search-clear" onClick={handleClear} title="Clear">
              &#x2715;
            </button>
          )}
        </div>

        {results && !loading && (
          <div className="search-summary">
            {results.total_matches === 0 ? (
              <span>No matches found</span>
            ) : (
              <>
                <span className="search-summary-count">
                  {results.total_matches.toLocaleString()}{' '}
                  {results.total_matches === 1 ? 'match' : 'matches'}
                </span>
                <span className="search-summary-sep">·</span>
                <span>
                  {results.results.length} of {results.total_tables_searched}{' '}
                  {results.total_tables_searched === 1 ? 'table' : 'tables'} matched
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="search-results">
        {!query && (
          <div className="empty-state">
            <div className="empty-state-icon">&#9906;</div>
            <div className="empty-state-title">Search across all tables</div>
            <div className="empty-state-text">
              Type any value — an ID, name, email, date — and Otto will scan every
              column in every table of <strong>{dbName}</strong> instantly.
              <br />
              <br />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                Tip: press <kbd className="search-kbd">⌘K</kbd> from any view to jump here.
              </span>
            </div>
          </div>
        )}

        {noResults && !loading && (
          <div className="empty-state">
            <div className="empty-state-icon" style={{ fontSize: 32, opacity: 0.2 }}>&#9906;</div>
            <div className="empty-state-title">No results for "{query}"</div>
            <div className="empty-state-text">
              No rows matched across {results!.total_tables_searched} tables. Try a different term.
            </div>
          </div>
        )}

        {error && (
          <div className="search-error">
            <span>&#9888;</span> {error}
          </div>
        )}

        {hasResults && results!.results.map((tableResult) => (
          <TableResultGroup
            key={tableResult.table}
            result={tableResult}
            query={query}
            onNavigate={onNavigateToTable}
          />
        ))}
      </div>
    </div>
  );
}
