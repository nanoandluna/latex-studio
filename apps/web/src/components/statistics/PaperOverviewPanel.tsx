import { useEffect } from 'react';
import { usePaperOverviewStore } from '../../stores/paperOverviewStore';
import { useEditorStore } from '../../stores/editorStore';

/**
 * V0.5-PLAN 1 — the paper dashboard: structure, content, assets, references
 * and diagnostics at a glance, with a per-chapter breakdown that jumps to the
 * source. Every number comes from the Project Graph — nothing is re-scanned.
 */
export function PaperOverviewPanel() {
  const { data, loading, error } = usePaperOverviewStore();
  const load = usePaperOverviewStore((s) => s.load);
  const openFileAtLine = useEditorStore((s) => s.openFileAtLine);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <div className="p-3 text-[13px] text-zinc-400">Reading the paper…</div>;
  if (error) return <div className="p-3 text-[13px] text-red-600">{error}</div>;
  if (!data) return <div className="p-3 text-[13px] text-zinc-400">No overview yet.</div>;

  return (
    <div data-testid="paper-overview" className="space-y-3 p-3">
      <Section title="Structure">
        <Metric label="Chapters" value={data.structure.chapters} />
        <Metric label="Sections" value={data.structure.sections} />
      </Section>

      <Section title="Content">
        <Metric label="CJK chars" value={data.content.cjkCharacters} />
        <Metric label="Latin words" value={data.content.latinWords} />
        <Metric label="Est. words" value={data.content.estimatedWords} primary />
      </Section>

      <Section title="Assets">
        <Metric label="Figures" value={data.assets.figures} />
        <Metric label="Tables" value={data.assets.tables} />
        <Metric label="Equations" value={data.assets.equations} />
      </Section>

      <Section title="References">
        <Metric label="Citations" value={data.references.citations} />
        <Metric label="Bib entries" value={data.references.bibEntries} />
        {data.references.undefinedCitations > 0 && (
          <Metric
            label="Undefined cites"
            value={data.references.undefinedCitations}
            alert
          />
        )}
        {data.references.undefinedReferences > 0 && (
          <Metric
            label="Undefined refs"
            value={data.references.undefinedReferences}
            alert
          />
        )}
      </Section>

      <Section title="Diagnostics">
        <Metric label="Errors" value={data.diagnostics.errors} alert={data.diagnostics.errors > 0} />
        <Metric
          label="Warnings"
          value={data.diagnostics.warnings}
          alert={data.diagnostics.warnings > 0}
        />
      </Section>

      {data.chapters.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
            Chapters
          </h3>
          <div className="space-y-1">
            {data.chapters.map((c, i) => (
              <button
                key={`${c.file}:${c.line}:${i}`}
                onClick={() => void openFileAtLine(c.file, c.line)}
                className="block w-full rounded px-1 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                title={`${c.file}:${c.line}`}
              >
                <div className="truncate text-[13px] font-medium">{c.title}</div>
                <div className="text-xs text-zinc-500">
                  {c.cjkCharacters.toLocaleString()} CJK · {c.citations} cites · {c.figures} fig ·{' '}
                  {c.tables} tab · {c.equations} eq
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs leading-relaxed text-zinc-400">
        Counts follow the statistics model: comments, the preamble and math bodies are excluded;
        chapters cover their own file up to the next chapter.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">{children}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  primary,
  alert,
}: {
  label: string;
  value: number;
  primary?: boolean;
  alert?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-zinc-100 pb-0.5 dark:border-zinc-800/60">
      <span className="text-xs text-zinc-500">{label}</span>
      <span
        className={`font-mono text-[13px] ${
          alert
            ? 'font-semibold text-amber-600 dark:text-amber-400'
            : primary
              ? 'font-semibold text-zinc-900 dark:text-zinc-100'
              : 'text-zinc-600 dark:text-zinc-400'
        }`}
      >
        {value.toLocaleString()}
      </span>
    </div>
  );
}
