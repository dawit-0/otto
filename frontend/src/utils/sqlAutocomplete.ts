import type { TableInfo } from '../api';

export type CompletionKind = 'table' | 'column' | 'keyword';

export interface Suggestion {
  label: string;
  kind: CompletionKind;
  detail?: string;
}

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN',
  'FULL JOIN', 'CROSS JOIN', 'ON', 'AND', 'OR', 'NOT', 'IN', 'LIKE',
  'BETWEEN', 'IS NULL', 'IS NOT NULL', 'ORDER BY', 'GROUP BY', 'HAVING',
  'LIMIT', 'OFFSET', 'DISTINCT', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE',
  'DROP TABLE', 'ALTER TABLE', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'COALESCE', 'NULLIF', 'CAST', 'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT',
  'EXISTS', 'WITH', 'RECURSIVE', 'RETURNING', 'NULL', 'TRUE', 'FALSE',
];

const TABLE_TRIGGER = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+$/i;
const COLUMN_TRIGGER = /\b(?:SELECT|WHERE|ON|AND|OR|BY|HAVING|SET|RETURNING)\s+$/i;
const COMMA_TRIGGER = /,\s*$/;

function extractReferencedTables(sql: string): string[] {
  const tables: string[] = [];
  const re = /\b(?:FROM|JOIN)\s+["'`]?(\w+)["'`]?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    tables.push(m[1].toLowerCase());
  }
  return tables;
}

interface CompletionContext {
  kind: CompletionKind | null;
  prefix: string;
  qualifiedTable?: string;
  referencedTables?: string[];
}

export function getCompletionContext(text: string, cursorPos: number): CompletionContext {
  const before = text.slice(0, cursorPos);

  // Current token being typed (word chars + possible dot prefix)
  const tokenMatch = before.match(/[\w.]*$/);
  const token = tokenMatch ? tokenMatch[0] : '';
  const textBeforeToken = before.slice(0, before.length - token.length);

  // Qualified: "tablename.partial"
  const dotIdx = token.indexOf('.');
  if (dotIdx !== -1) {
    return {
      kind: 'column',
      prefix: token.slice(dotIdx + 1).toLowerCase(),
      qualifiedTable: token.slice(0, dotIdx).toLowerCase(),
    };
  }

  const prefix = token.toLowerCase();

  if (TABLE_TRIGGER.test(textBeforeToken)) {
    return { kind: 'table', prefix };
  }

  if (COLUMN_TRIGGER.test(textBeforeToken) || COMMA_TRIGGER.test(textBeforeToken)) {
    return { kind: 'column', prefix, referencedTables: extractReferencedTables(text) };
  }

  if (prefix.length >= 2) {
    return { kind: 'keyword', prefix };
  }

  return { kind: null, prefix };
}

export function getSuggestions(ctx: CompletionContext, schema: TableInfo[]): Suggestion[] {
  if (!ctx.kind) return [];
  const { prefix } = ctx;

  if (ctx.kind === 'table') {
    return schema
      .filter((t) => t.name.toLowerCase().startsWith(prefix))
      .map((t) => ({ label: t.name, kind: 'table' as const, detail: `${t.row_count} rows` }));
  }

  if (ctx.kind === 'column') {
    if (ctx.qualifiedTable) {
      const table = schema.find((t) => t.name.toLowerCase() === ctx.qualifiedTable);
      if (!table) return [];
      return table.columns
        .filter((c) => c.name.toLowerCase().startsWith(prefix))
        .map((c) => ({ label: c.name, kind: 'column' as const, detail: c.type }));
    }

    const sourceTables =
      ctx.referencedTables && ctx.referencedTables.length > 0
        ? schema.filter((t) => ctx.referencedTables!.includes(t.name.toLowerCase()))
        : schema;

    const seen = new Set<string>();
    const cols: Suggestion[] = [];
    for (const t of sourceTables) {
      for (const c of t.columns) {
        if (!seen.has(c.name) && c.name.toLowerCase().startsWith(prefix)) {
          seen.add(c.name);
          cols.push({ label: c.name, kind: 'column', detail: c.type });
        }
      }
    }
    return cols;
  }

  if (ctx.kind === 'keyword') {
    return SQL_KEYWORDS.filter((k) => k.toLowerCase().startsWith(prefix)).map((k) => ({
      label: k,
      kind: 'keyword' as const,
    }));
  }

  return [];
}

/** Compute where to show the dropdown (viewport-fixed coords). */
export function getCaretViewportCoords(
  textarea: HTMLTextAreaElement,
  position: number,
): { top: number; left: number } {
  const style = window.getComputedStyle(textarea);
  const taRect = textarea.getBoundingClientRect();
  const lineHeight = parseFloat(style.lineHeight) || 20;

  const mirror = document.createElement('div');

  const copyProps = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
    'letterSpacing', 'wordSpacing', 'textTransform', 'textIndent',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'boxSizing',
  ] as const;

  copyProps.forEach((p) => {
    (mirror.style as unknown as Record<string, string>)[p] = style[p];
  });

  mirror.style.position = 'fixed';
  mirror.style.top = `${taRect.top - textarea.scrollTop}px`;
  mirror.style.left = `${taRect.left}px`;
  mirror.style.width = `${taRect.width}px`;
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.overflow = 'visible';
  mirror.style.pointerEvents = 'none';

  mirror.textContent = textarea.value.slice(0, position);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(marker);

  document.body.appendChild(mirror);
  const markerRect = marker.getBoundingClientRect();
  document.body.removeChild(mirror);

  return {
    top: markerRect.top + lineHeight,
    left: markerRect.left,
  };
}
