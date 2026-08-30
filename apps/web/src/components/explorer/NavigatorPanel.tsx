import { useMemo, useState } from 'react';
import { useProjectIndexStore } from '../../stores/projectIndexStore';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import { StatisticsPanel } from '../statistics/StatisticsPanel';
import { PaperOverviewPanel } from '../statistics/PaperOverviewPanel';
import { CitationWorkspacePanel } from '../citations/CitationWorkspacePanel';

type GroupKey =
  | 'sections'
  | 'figures'
  | 'tables'
  | 'equations'
  | 'citations'
  | 'labels'
  | 'diagnostics';

const GROUPS: { key: GroupKey; label: string; icon: string }[] = [
  { key: 'sections', label: 'Sections', icon: '§' },
  { key: 'figures', label: 'Figures', icon: '🖼' },
  { key: 'tables', label: 'Tables', icon: '▦' },
  { key: 'equations', label: 'Equations', icon: '∑' },
  { key: 'citations', label: 'Citations', icon: '📚' },
  { key: 'labels', label: 'Labels', icon: '#' },
  { key: 'diagnostics', label: 'Diagnostics', icon: '⚠' },
];

interface Row {
  title: string;
  file: string;
  line: number;
  hint?: string;
  /** usage count badge */
  uses?: number;
  /** problem marker (undefined / unused / missing) */
  flag?: 'undefined' | 'unused';
}

export function NavigatorPanel() {
  const index = useProjectIndexStore((s) => s.index);
  const openFileAtLine = useEditorStore((s) => s.openFileAtLine);
  // The view lives in the ui store so palette commands can set it before this
  // panel mounts — a dispatch-then-listen custom event would race the mount.
  const view = useUiStore((s) => s.navigatorView);
  const setView = useUiStore((s) => s.setNavigatorView);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    if (!index) return null;
    const refCount = new Map<string, number>();
    for (const r of index.references) refCount.set(r.key, (refCount.get(r.key) ?? 0) + 1);
    const citeCount = new Map<string, number>();
    for (const c of index.citations) citeCount.set(c.key, (citeCount.get(c.key) ?? 0) + 1);
    const bibKeys = new Set(index.bibEntries.map((b) => b.key));
    const labelKeys = new Set(index.labels.map((l) => l.key));

    const sections = index.sections.map((s) => ({
      title: s.title,
      file: s.file,
      line: s.line,
      hint: `${s.file}:${s.line}`,
    }));
    const figures = index.figures.map((f) => ({
      title: f.caption ?? f.key ?? '(figure)',
      file: f.file,
      line: f.line,
      hint: f.key ?? '',
      uses: f.key ? (refCount.get(f.key) ?? 0) : undefined,
    }));
    const tables = index.tables.map((t) => ({
      title: t.caption ?? t.key ?? '(table)',
      file: t.file,
      line: t.line,
      hint: t.key ?? '',
      uses: t.key ? (refCount.get(t.key) ?? 0) : undefined,
    }));
    const equations = index.equations.map((e) => ({
      title: e.key ?? '(equation)',
      file: e.file,
      line: e.line,
      hint: e.key ?? '',
      uses: e.key ? (refCount.get(e.key) ?? 0) : undefined,
    }));
    const citations = dedupe(
      index.citations.map((c) => ({
        title: c.key,
        file: c.file,
        line: c.line,
        hint: bibTitle(index, c.key),
        uses: citeCount.get(c.key) ?? 0,
        flag: bibKeys.has(c.key) ? undefined : ('undefined' as const),
      }))
    );
    const labels = dedupe(
      index.labels.map((l) => ({
        title: l.key,
        file: l.file,
        line: l.line,
        hint: `${l.file}:${l.line}`,
        uses: refCount.get(l.key) ?? 0,
        flag: (refCount.get(l.key) ?? 0) === 0 ? ('unused' as const) : undefined,
      }))
    );

    // usage sites per symbol for the inline inspector expansion
    const usages = new Map<string, typeof index.references>();
    for (const r of index.references) {
      const arr = usages.get(r.key);
      if (arr) arr.push(r);
      else usages.set(r.key, [r]);
    }

    const diagnostics = index.diagnostics.map((d) => ({
      title: d.message,
      file: d.file || 'main.tex',
      line: d.line || 1,
      hint: d.code,
      severity: d.severity as string,
    }));

    return { sections, figures, tables, equations, citations, labels, diagnostics, usages, labelKeys };
  }, [index]);

  if (!grouped) {
    return <div className="px-3 py-2 text-xs text-zinc-400">No index yet.</div>;
  }

  const renderRows = (key: GroupKey, items: Row[]) =>
    items.slice(0, 120).map((it, i) => {
      const expandKey = `${key}:${i}`;
      const isOpen = expanded[expandKey];
      const usageSites =
        key === 'labels' || key === 'figures' || key === 'tables' || key === 'equations'
          ? grouped.usages.get(it.title) ?? []
          : [];
      const hasUsages = usageSites.length > 0;
      return (
        <div key={`${key}:${i}:${it.line}`}>
          <button
            onClick={async () => {
              if (hasUsages && it.uses !== undefined && it.uses > 1) {
                setExpanded((e) => ({ ...e, [expandKey]: !e[expandKey] }));
                return;
              }
              await openFileAtLine(it.file, it.line);
            }}
            onDoubleClick={() => void openFileAtLine(it.file, it.line)}
            title={`${it.hint} — ${it.file}:${it.line}`}
            className="flex w-full items-baseline gap-2 rounded py-0.5 pr-2 pl-7 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <span className="truncate">{it.title}</span>
            {it.flag && (
              <span
                className={`shrink-0 rounded px-1 text-[9px] ${
                  it.flag === 'undefined'
                    ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                    : 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                }`}
              >
                {it.flag}
              </span>
            )}
            {typeof it.uses === 'number' && (
              <span className="ml-auto shrink-0 font-mono text-xs text-zinc-400">
                ×{it.uses}
              </span>
            )}
          </button>
          {isOpen &&
            usageSites.map((u, k) => (
              <button
                key={k}
                onClick={() => void openFileAtLine(u.file, u.line)}
                className="block w-full rounded py-0.5 pr-2 pl-11 text-left text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                ↳ {u.file}:{u.line}
              </button>
            ))}
          {!hasUsages && null}
        </div>
      );
    });

  return (
    <div className="pb-2">
      <div className="flex items-center gap-1 border-b border-zinc-200 px-2 pb-1 dark:border-zinc-800">
        {(
          [
            ['overview', 'Overview'],
            ['citations', 'Citations'],
            ['symbols', 'Symbols'],
            ['stats', 'Stats'],
          ] as const
        ).map(([key, text]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${
              view === key
                ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            {text}
          </button>
        ))}
      </div>

      {view === 'overview' && <PaperOverviewPanel />}
      {view === 'citations' && <CitationWorkspacePanel />}
      {view === 'stats' && <StatisticsPanel />}

      {view === 'symbols' && GROUPS.map(({ key, label, icon }) => {
        const items =
          key === 'diagnostics'
            ? (grouped.diagnostics.map((d) => ({
                title: d.title,
                file: d.file,
                line: d.line,
                severity: d.severity,
              })) as unknown as Row[])
            : ((grouped[key] ?? []) as unknown as Row[]);
        const isCollapsed = collapsed[key];
        return (
          <div key={key} className="mt-1">
            <button
              className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-[13px] font-semibold tracking-wide text-zinc-500 uppercase hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
            >
              <span className="w-3">{isCollapsed ? '▸' : '▾'}</span>
              <span>{icon}</span>
              <span>{label}</span>
              {items.length > 0 && (
                <span className="ml-auto font-normal normal-case">{items.length}</span>
              )}
            </button>
            {!isCollapsed && renderRows(key, items)}
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

type IndexShape = NonNullable<ReturnType<typeof useProjectIndexStore.getState>['index']>;

function bibTitle(index: IndexShape, key: string): string {
  const entry = index.bibEntries.find((b) => b.key === key);
  if (!entry) return 'missing in .bib';
  const bits = [entry.author?.split(' and ')[0], entry.year].filter(Boolean);
  return [bits.join(', '), entry.title].filter(Boolean).join(' — ');
}
