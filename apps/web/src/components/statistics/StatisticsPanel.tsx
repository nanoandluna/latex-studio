import { useEffect, useMemo } from 'react';
import { useStatisticsStore } from '../../stores/statisticsStore';
import { useEditorStore } from '../../stores/editorStore';
import type { StatisticsSection } from '@latex-studio/shared';

/**
 * Writing statistics: project totals plus a per-chapter breakdown.
 *
 * The bars are plain CSS (a width percentage on a div) — pulling in a charting
 * library for a handful of horizontal bars is not worth the bundle.
 */
export function StatisticsPanel() {
  const { data, loading, error } = useStatisticsStore();
  const load = useStatisticsStore((s) => s.load);
  const openFileAtLine = useEditorStore((s) => s.openFileAtLine);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const source = data.chapters.length > 0 ? data.chapters : data.sections;
    const max = Math.max(1, ...source.map((s) => s.stats.estimatedWords));
    return source.map((s) => ({ ...s, pct: (s.stats.estimatedWords / max) * 100 }));
  }, [data]);

  if (loading && !data) {
    return <div className="p-3 text-[11px] text-zinc-400">Counting…</div>;
  }
  if (error) {
    return <div className="p-3 text-[11px] text-red-600">{error}</div>;
  }
  if (!data) {
    return <div className="p-3 text-[11px] text-zinc-400">No statistics yet.</div>;
  }

  const p = data.project;

  return (
    <div className="space-y-3 p-3">
      <div>
        <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
          Project
        </h3>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <Metric label="Words" value={p.estimatedWords} primary />
          <Metric label="CJK chars" value={p.cjkCharacters} />
          <Metric label="Latin words" value={p.latinWords} />
          <Metric label="Numbers" value={p.numericTokens} />
          <Metric label="Equations" value={p.equations} />
          <Metric label="Sections" value={p.sections} />
          <Metric label="Figures" value={p.figures} />
          <Metric label="Tables" value={p.tables} />
          <Metric label="Citations" value={p.citations} />
          <Metric label="Bib entries" value={p.bibEntries} />
        </div>
      </div>

      <div>
        <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
          {data.chapters.length > 0 ? 'Chapters' : 'Sections'} by words
        </h3>
        {rows.length === 0 && (
          <p className="text-[11px] text-zinc-400">No sections found in this project.</p>
        )}
        <div className="space-y-1">
          {rows.map((r, i) => (
            <ChapterBar key={`${r.file}:${r.line}:${i}`} row={r} onClick={() => void openFileAtLine(r.file, r.line)} />
          ))}
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-zinc-400">
        Counts cover body text only: comments, command arguments, the preamble and math
        environments are excluded. Section totals therefore sum to less than the project
        total.
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  primary,
}: {
  label: string;
  value: number;
  primary?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-zinc-100 pb-0.5 dark:border-zinc-800/60">
      <span className="text-[10px] text-zinc-500">{label}</span>
      <span
        className={`font-mono text-[11px] ${
          primary ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'text-zinc-600 dark:text-zinc-400'
        }`}
      >
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function ChapterBar({ row, onClick }: { row: StatisticsSection & { pct: number }; onClick: () => void }) {
  return (
    <button onClick={onClick} className="block w-full text-left" title={`${row.file}:${row.line}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[10px] text-zinc-600 dark:text-zinc-400">{row.title}</span>
        <span className="shrink-0 font-mono text-[10px] text-zinc-500">
          {row.stats.estimatedWords.toLocaleString()}
        </span>
      </div>
      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-blue-500"
          style={{ width: `${Math.max(1.5, row.pct)}%` }}
        />
      </div>
    </button>
  );
}
