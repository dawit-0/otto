import { useEffect, useRef } from 'react';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { sql, SQLite } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';

interface Props {
  value: string;
  onChange: (val: string) => void;
  onExecute: () => void;
  schema?: Record<string, string[]>;
  placeholder?: string;
}

// Otto-branded overrides applied on top of oneDark
const ottoOverrides = EditorView.theme(
  {
    '&': { backgroundColor: '#18181b' },
    '.cm-content': { padding: '10px 0', caretColor: '#6366f1' },
    '.cm-gutters': {
      backgroundColor: '#18181b',
      borderRight: '1px solid rgba(255,255,255,0.07)',
      color: '#52525b',
    },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(99,102,241,0.07)' },
    '.cm-activeLine': { backgroundColor: 'rgba(99,102,241,0.05)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#6366f1' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'rgba(99,102,241,0.22)',
    },
    '.cm-placeholder': { color: '#52525b', fontStyle: 'italic' },
    '.cm-tooltip': {
      backgroundColor: '#27272a',
      border: '1px solid rgba(255,255,255,0.10)',
      borderRadius: '8px',
    },
    '.cm-tooltip-autocomplete': {
      '& > ul': {
        fontFamily: '"SF Mono","Cascadia Code","Fira Code",Consolas,monospace',
        fontSize: '12px',
      },
      '& > ul > li[aria-selected]': {
        backgroundColor: 'rgba(99,102,241,0.30)',
        color: '#fafafa',
      },
    },
    '.cm-completionIcon': { display: 'none' },
    '.cm-completionLabel': { color: '#e4e4e7' },
    '.cm-completionDetail': { color: '#71717a', marginLeft: '8px' },
    '.cm-searchMatch': { backgroundColor: 'rgba(99,102,241,0.3)', borderRadius: '2px' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(99,102,241,0.55)' },
    '.cm-foldPlaceholder': {
      backgroundColor: 'rgba(99,102,241,0.2)',
      color: '#a5b4fc',
      border: 'none',
    },
  },
  { dark: true },
);

export default function SQLEditor({ value, onChange, onExecute, schema = {}, placeholder }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onExecuteRef = useRef(onExecute);
  const sqlCompartment = useRef(new Compartment());

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onExecuteRef.current = onExecute; }, [onExecute]);

  // Mount editor once
  useEffect(() => {
    if (!containerRef.current) return;

    const executeKeymap = keymap.of([{
      key: 'Mod-Enter',
      run: () => { onExecuteRef.current(); return true; },
    }]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) onChangeRef.current(update.state.doc.toString());
    });

    const extensions = [
      basicSetup,
      oneDark,
      ottoOverrides,
      executeKeymap,
      updateListener,
      sqlCompartment.current.of(sql({ dialect: SQLite, schema, upperCaseKeywords: false })),
      EditorView.lineWrapping,
      ...(placeholder ? [cmPlaceholder(placeholder)] : []),
    ];

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reconfigure SQL dialect + schema when schema changes
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: sqlCompartment.current.reconfigure(
        sql({ dialect: SQLite, schema, upperCaseKeywords: false }),
      ),
    });
  }, [schema]);

  // Sync controlled value (e.g. loading from history)
  useEffect(() => {
    if (!viewRef.current) return;
    const doc = viewRef.current.state.doc.toString();
    if (doc !== value) {
      viewRef.current.dispatch({ changes: { from: 0, to: doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={containerRef} className="sql-editor-cm" />;
}
