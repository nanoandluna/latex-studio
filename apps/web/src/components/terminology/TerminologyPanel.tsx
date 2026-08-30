import { useEffect, useState } from 'react';
import { useTerminologyStore } from '../../stores/terminologyStore';
import { useEditorStore } from '../../stores/editorStore';
import type { TerminologyTerm } from '@latex-studio/shared';

/**
 * V0.5-PLAN 4 — terminology consistency: the user-defined glossary plus the
 * rule-based hits (variants / acronyms / forbidden forms found in the body).
 * Pure rules, no AI.
 */
export function TerminologyPanel() {
  const { terms, hits, loading, saving, error } = useTerminologyStore();
  const load = useTerminologyStore((s) => s.load);
  const save = useTerminologyStore((s) => s.save);
  const openFileAtLine = useEditorStore((s) => s.openFileAtLine);

  const [preferred, setPreferred] = useState('');
  const [variants, setVariants] = useState('');

  useEffect(() => {
    void load();
  }, [load]);

  const addTerm = async () => {
    if (!preferred.trim()) return;
    const term: TerminologyTerm = {
      preferred: preferred.trim(),
      variants: variants
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    };
    setPreferred('');
    setVariants('');
    await save([...terms, term]);
  };

  const removeTerm = async (t: TerminologyTerm) => {
    await save(terms.filter((x) => x.preferred !== t.preferred));
  };

  return (
    <div data-testid="terminology-panel" className="p-3">
      {error && <p className="mb-2 text-[13px] text-red-600">{error}</p>}

      {/* glossary editor */}
      <div className="mb-3 rounded border border-zinc-200 p-2 dark:border-zinc-800">
        <p className="mb-1 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
          Preferred term + variants (comma-separated)
        </p>
        <input
          value={preferred}
          onChange={(e) => setPreferred(e.target.value)}
          placeholder="e.g. mmWave radar"
          className="mb-1 w-full rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          value={variants}
          onChange={(e) => setVariants(e.target.value)}
          placeholder="e.g. millimeter-wave radar, 毫米波雷达"
          className="mb-1.5 w-full rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          onClick={() => void addTerm()}
          disabled={!preferred.trim() || saving}
          className="rounded bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Add term'}
        </button>
      </div>

      {terms.length > 0 && (
        <div className="mb-3 space-y-1">
          {terms.map((t) => (
            <div
              key={t.preferred}
              className="flex items-baseline gap-2 rounded border border-zinc-200 px-2 py-1 dark:border-zinc-800"
            >
              <span className="truncate text-[13px] font-medium">{t.preferred}</span>
              <span className="truncate text-xs text-zinc-500">
                {t.variants.length + (t.acronym ? 1 : 0) > 0
                  ? `variants: ${[...t.variants, t.acronym].filter(Boolean).join(', ')}`
                  : 'no variants'}
              </span>
              <button
                onClick={() => void removeTerm(t)}
                title="Delete term"
                className="ml-auto shrink-0 rounded px-1 text-xs text-zinc-400 hover:text-red-600"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* hits */}
      <p className="mb-1 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
        {hits.length > 0 ? `Inconsistencies (${hits.length})` : 'Inconsistencies'}
      </p>
      {loading && <p className="text-[13px] text-zinc-400">Scanning…</p>}
      {!loading && terms.length === 0 && (
        <p className="text-[13px] text-zinc-400">
          Define a term above — its variants are flagged wherever they appear.
        </p>
      )}
      {!loading && terms.length > 0 && hits.length === 0 && (
        <p className="text-[13px] text-emerald-600">Consistent — no variants found.</p>
      )}
      <div className="space-y-1">
        {hits.map((h, i) => (
          <button
            key={`${h.file}:${h.line}:${i}`}
            onClick={() => void openFileAtLine(h.file, h.line)}
            className="block w-full rounded px-1 py-0.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title={`${h.file}:${h.line}`}
          >
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 font-mono text-[11px] text-amber-600 dark:text-amber-400">
                {h.matched}
              </span>
              <span className="shrink-0 text-[11px] text-zinc-400">→ {h.preferred}</span>
            </div>
            <div className="truncate font-mono text-[11px] text-zinc-500">
              {h.file}:{h.line} · {h.context}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
