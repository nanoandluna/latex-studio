import { useMemo, useState } from 'react';
import { useProjectIndexStore } from '../../stores/projectIndexStore';
import { useEditorStore } from '../../stores/editorStore';

type GroupKey = 'sections' | 'figures' | 'tables' | 'equations' | 'citations' | 'labels';

const GROUPS: { key: GroupKey; label: string; icon: string }[] = [
  { key: 'sections', label: 'Sections', icon: '§' },
  { key: 'figures', label: 'Figures', icon: '🖼' },
  { key: 'tables', label: 'Tables', icon: '▦' },
  { key: 'equations', label: 'Equations', icon: '∑' },
  { key: 'citations', label: 'Citations', icon: '📚' },
  { key: 'labels', label: 'Labels', icon: '#' },
];

export function NavigatorPanel() {
  const index = useProjectIndexStore((s) => s.index);
  const openFileAtLine = useEditorStore((s) => s.openFileAtLine);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    if (!index) return null;
    return {
      sections: index.sections.map((s) => ({
        title: s.title,
        file: s.file,
        line: s.line,
        hint: `${s.file}:${s.line}`,
      })),
      figures: index.figures.map((f) => ({
        title: f.caption ?? f.key ?? '(figure)',
        file: f.file,
        line: f.line,
        hint: f.key ?? `${f.file}:${f.line}`,
      })),
      tables: index.tables.map((t) => ({
        title: t.caption ?? t.key ?? '(table)',
        file: t.file,
        line: t.line,
        hint: t.key ?? `${t.file}:${t.line}`,
      })),
      equations: index.equations.map((e) => ({
        title: e.key ?? '(equation)',
        file: e.file,
        line: e.line,
        hint: e.key ?? `${e.file}:${e.line}`,
      })),
      citations: dedupe(
        index.citations.map((c) => ({
          title: c.key,
          file: c.file,
          line: c.line,
          hint: bibTitle(index, c.key),
        }))
      ),
      labels: dedupe(
        index.labels.map((l) => ({ title: l.key, file: l.file, line: l.line, hint: `${l.file}:${l.line}` }))
      ),
    };
  }, [index]);

  if (!grouped) {
    return <div className="px-3 py-2 text-xs text-zinc-400">No index yet.</div>;
  }

  return (
    <div className="pb-2">
      {GROUPS.map(({ key, label, icon }) => {
        const items = grouped[key];
        const isCollapsed = collapsed[key];
        return (
          <div key={key} className="mt-1">
            <button
              className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
            >
              <span className="w-3">{isCollapsed ? '▸' : '▾'}</span>
              <span>{icon}</span>
              <span>{label}</span>
              <span className="ml-auto font-normal normal-case">{items.length || ''}</span>
            </button>
            {!isCollapsed &&
              items.slice(0, 100).map((it, i) => (
                <button
                  key={`${key}:${i}:${it.title}:${it.line}`}
                  onClick={() => void openFileAtLine(it.file, it.line)}
                  title={`${it.hint} — ${it.file}:${it.line}`}
                  className="flex w-full items-baseline gap-2 rounded py-0.5 pr-2 pl-7 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="truncate">{it.title}</span>
                  {it.hint !== it.title && (
                    <span className="ml-auto shrink-0 truncate pl-2 font-mono text-[10px] text-zinc-400">
                      {it.hint}
                    </span>
                  )}
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}

function dedupe<T extends { title: string; file: string; line: number }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const k = `${it.title}|${it.file}|${it.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function bibTitle(index: NonNullable<ReturnType<typeof useProjectIndexStore.getState>['index']>, key: string): string {
  const entry = index.bibEntries.find((b) => b.key === key);
  if (!entry) return 'missing in .bib';
  const bits = [entry.author?.split(' and ')[0], entry.year].filter(Boolean);
  return [bits.join(', '), entry.title].filter(Boolean).join(' — ');
}
