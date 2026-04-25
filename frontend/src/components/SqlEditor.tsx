import { useEffect, useRef, useCallback } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { sql, SQLite } from '@codemirror/lang-sql';
import { type TableInfo } from '../api';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  schema: TableInfo[];
}

function buildSchemaMap(tables: TableInfo[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const t of tables) {
    map[t.name] = t.columns.map((c) => c.name);
  }
  return map;
}

const ottoDarkHighlight = HighlightStyle.define([
  { tag: tags.keyword,              color: '#818cf8', fontWeight: '500' },
  { tag: tags.number,               color: '#34d399' },
  { tag: [tags.string, tags.special(tags.string)], color: '#f9a8d4' },
  { tag: tags.comment,              color: '#52525b', fontStyle: 'italic' },
  { tag: tags.typeName,             color: '#7dd3fc' },
  { tag: tags.operator,             color: '#f59e0b' },
  { tag: tags.punctuation,          color: '#a1a1aa' },
  { tag: tags.variableName,         color: '#fafafa' },
]);

export default function SqlEditor({ value, onChange, onRun, schema }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onRunRef = useRef(onRun);
  const onChangeRef = useRef(onChange);

  onRunRef.current = onRun;
  onChangeRef.current = onChange;

  const createView = useCallback((container: HTMLElement, initialValue: string, tables: TableInfo[]) => {
    const schemaMap = buildSchemaMap(tables);

    const runKeymap = keymap.of([
      {
        key: 'Mod-Enter',
        run() {
          onRunRef.current();
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const theme = EditorView.theme({
      '&': {
        background: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
        minHeight: '120px',
        transition: 'border-color 0.15s ease',
      },
      '&.cm-focused': {
        outline: 'none',
        borderColor: 'var(--accent)',
        boxShadow: '0 0 0 2px var(--ring-color)',
      },
      '.cm-scroller': {
        fontFamily: 'var(--font-mono)',
        lineHeight: '1.6',
        minHeight: '120px',
        overflow: 'auto',
        padding: '10px 0',
      },
      '.cm-content': {
        padding: '0 12px',
        caretColor: 'var(--accent)',
        minHeight: '100px',
      },
      '.cm-line': {
        padding: '0 2px',
      },
      '.cm-gutters': {
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border)',
        color: 'var(--text-muted)',
        userSelect: 'none',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 10px 0 8px',
        minWidth: '32px',
        textAlign: 'right',
        fontSize: '11px',
      },
      '.cm-activeLineGutter': {
        background: 'var(--bg-tertiary)',
        color: 'var(--text-secondary)',
      },
      '.cm-activeLine': {
        background: 'rgba(255,255,255,0.025)',
      },
      '.cm-cursor': {
        borderLeftColor: 'var(--accent)',
      },
      '.cm-selectionBackground, ::selection': {
        background: 'rgba(99,102,241,0.25) !important',
      },
      '.cm-matchingBracket': {
        background: 'rgba(99,102,241,0.2)',
        outline: '1px solid var(--accent)',
        borderRadius: '2px',
      },
      // Autocomplete dropdown
      '.cm-tooltip': {
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-lg)',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
      },
      '.cm-tooltip.cm-tooltip-autocomplete': {
        padding: '2px 0',
      },
      '.cm-tooltip-autocomplete > ul': {
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        maxHeight: '200px',
        overflowY: 'auto',
      },
      '.cm-tooltip-autocomplete > ul > li': {
        padding: '4px 12px',
        color: 'var(--text-secondary)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        background: 'var(--accent-subtle)',
        color: 'var(--accent-hover)',
      },
      '.cm-completionIcon': {
        fontSize: '10px',
        width: '14px',
        opacity: 0.6,
      },
      '.cm-completionLabel': {
        flex: 1,
      },
      '.cm-completionDetail': {
        color: 'var(--text-muted)',
        fontSize: '11px',
        marginLeft: '8px',
      },
    }, { dark: true });

    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ defaultKeymap: true }),
        syntaxHighlighting(ottoDarkHighlight, { fallback: true }),
        sql({ dialect: SQLite, schema: schemaMap, upperCaseKeywords: false }),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        runKeymap,
        updateListener,
        theme,
        EditorView.lineWrapping,
      ],
    });

    return new EditorView({ state, parent: container });
  }, []);

  // Initial mount
  useEffect(() => {
    if (!containerRef.current) return;
    const view = createView(containerRef.current, value, schema);
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep editor in sync when value changes externally (e.g. loaded from history)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  // Rebuild when schema changes so autocomplete knows new tables/columns
  useEffect(() => {
    const view = viewRef.current;
    const container = containerRef.current;
    if (!view || !container) return;
    const currentValue = view.state.doc.toString();
    view.destroy();
    const newView = createView(container, currentValue, schema);
    viewRef.current = newView;
  }, [schema, createView]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} className="sql-editor-cm" />;
}
