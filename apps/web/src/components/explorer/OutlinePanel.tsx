import { useMemo } from 'react';
import { useProjectIndexStore } from '../../stores/projectIndexStore';
import { useEditorStore } from '../../stores/editorStore';

const LEVEL_LABEL = ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];

export function OutlinePanel() {
  const index = useProjectIndexStore((s) => s.index);
  const loading = useProjectIndexStore((s) => s.loading);
  const openFileAtLine = useEditorStore((s) => s.openFileAtLine);

  // Compiled numbering per file (LaTeX restarts nothing across \input in
  // practice for our purposes — count sequentially over the sorted list).
  const numbered = useMemo(() => {
    if (!index) return [];
    const counters: number[] = [0, 0, 0, 0, 0, 0, 0];
    return index.sections.map((s) => {
      counters[s.level] += 1;
      for (let i = s.level + 1; i < counters.length; i++) counters[i] = 0;
      const label = counters.slice(0, s.level + 1).join('.');
      return { ...s, label };
    });
  }, [index]);

  if (!index) {
    return (
      <div className="px-3 py-2 text-xs text-zinc-400">
        {loading ? 'Indexing…' : 'No index yet — open a workspace with .tex files.'}
      </div>
    );
  }

  if (numbered.length === 0) {
    return <div className="px-3 py-2 text-xs text-zinc-400">No sections found.</div>;
  }

  return (
    <div className="pb-2">
      {numbered.map((s, i) => (
        <button
          key={`${s.file}:${s.line}:${i}`}
          onClick={() => void openFileAtLine(s.file, s.line)}
          title={`${s.file}:${s.line}`}
          className="flex w-full items-baseline gap-2 rounded px-2 py-0.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
          style={{ paddingLeft: `${8 + s.level * 12}px` }}
        >
          <span className="shrink-0 font-mono text-[10px] text-zinc-400">{s.label}</span>
          <span className="truncate">{s.title}</span>
        </button>
      ))}
      <div className="px-2 pt-1 text-[10px] text-zinc-500 dark:text-zinc-600">
        {LEVEL_LABEL.slice(0, 3).join(' · ')} … parsed from {new Set(index.sections.map((s) => s.file)).size} file(s)
      </div>
    </div>
  );
}
