import { useEffect, useRef } from 'react';
import type { Suggestion, CompletionKind } from '../utils/sqlAutocomplete';

interface Props {
  suggestions: Suggestion[];
  activeIndex: number;
  style: React.CSSProperties;
  onSelect: (s: Suggestion) => void;
}

const KIND_LABEL: Record<CompletionKind, string> = {
  table: 'T',
  column: 'C',
  keyword: 'K',
};

export default function SqlAutocomplete({ suggestions, activeIndex, style, onSelect }: Props) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (suggestions.length === 0) return null;

  return (
    <ul
      ref={listRef}
      className="sql-autocomplete"
      style={style}
      onMouseDown={(e) => e.preventDefault()}
    >
      {suggestions.map((s, i) => (
        <li
          key={`${s.kind}-${s.label}`}
          className={`sql-autocomplete-item${i === activeIndex ? ' active' : ''}`}
          onMouseEnter={() => {}}
          onClick={() => onSelect(s)}
        >
          <span className={`sql-ac-kind sql-ac-kind-${s.kind}`}>{KIND_LABEL[s.kind]}</span>
          <span className="sql-ac-label">{s.label}</span>
          {s.detail && <span className="sql-ac-detail">{s.detail}</span>}
        </li>
      ))}
    </ul>
  );
}
