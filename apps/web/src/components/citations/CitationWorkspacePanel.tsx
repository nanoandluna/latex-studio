import { useEffect, useState } from 'react';
import { useCitationWorkspaceStore } from '../../stores/citationWorkspaceStore';
import { useEditorStore } from '../../stores/editorStore';
import type { CitationEntryView } from '@latex-studio/shared';

type Filter = 'all' | 'used' | 'unused' | 'undefined' | 'duplicate';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'used', label: 'Used' },
  { key: 'unused', label: 'Unused' },
  { key: 'undefined', label: 'Undefined' },
  { key: 'duplicate', label: 'Duplicate' },
];

/**
 * V0.5-PLAN 2 — Citation Workspace: how the literature is actually used in
 * this paper. Strictly read-only — the .bib file belongs to Zotero/Better
 * BibTeX; this panel only shows where its keys land in the writing.
 */
export function CitationWorkspacePanel() {
  const { data, loading, error } = useCitationWorkspaceStore();
  const load = useCitationWorkspaceStore((s) => s.load);
  const openFileAtLine = useEditorStore((s) => s.openFileAtLine);
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <div className="p-3 text-[13px] text-zinc-400">Collecting citations…</div>;
  if (error) return <div className="p-3 text-[13px] text-red-600">{error}</div>;
  if (!data) return <div className="p-3 text-[13px] text-zinc-400">No citations yet.</div>;

  const filtered = data.entries.filter((e) => {
    if (filter === 'all') return true;
    if (filter === 'used') return e.used;
    if (filter === 'unused') return !e.used && !e.undefinedKey;
    if (filter === 'undefined') return e.undefinedKey;
    return e.duplicate;
  });

  const countOf = (f: Filter) =>
    f === 'all' ? data.counts.all : f === 'used' ? data.counts.used : f === 'unused' ? data.counts.unused : f === 'undefined' ? data.counts.undefined : data.counts.duplicate;

  return (
    <div data-testid="citation-workspace" className="p-3">
      <div className="mb-2 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded border px-1.5 py-0.5 text-[11px] ${
              filter === f.key
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                : 'border-zinc-300 text-zinc-500 dark:border-zinc-700'
            } ${f.key === 'undefined' && countOf('undefined') > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}
          >
            {f.label} {countOf(f.key)}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="py-2 text-[13px] text-zinc-400">
          {filter === 'all' ? 'No citations in this project yet.' : `No ${filter} citations.`}
        </p>
      )}

      <div className="space-y-1.5">
        {filtered.map((e) => (
          <CitationRow
            key={e.key}
            entry={e}
            expanded={expanded.has(e.key)}
            onToggle={() =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(e.key)) next.delete(e.key);
                else next.add(e.key);
                return next;
              })
            }
            onOpen={(file, line) => void openFileAtLine(file, line)}
          />
        ))}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-zinc-400">
        Read-only: the .bib file is managed by your reference manager (Zotero / Better BibTeX);
        this workspace shows where its keys are used in the paper.
      </p>
    </div>
  );
}

function CitationRow({
  entry,
  expanded,
  onToggle,
  onOpen,
}: {
  entry: CitationEntryView;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (file: string, line: number) => void;
}) {
  return (
    <div
      data-entry={entry.key}
      className={`rounded border px-2 py-1.5 ${
        entry.undefinedKey
          ? 'border-amber-300 dark:border-amber-800'
          : 'border-zinc-200 dark:border-zinc-800'
      }`}
    >
      <button onClick={onToggle} className="block w-full text-left">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-mono text-[13px] font-medium">{entry.key}</span>
          {entry.undefinedKey && (
            <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              not in .bib
            </span>
          )}
          {entry.duplicate && (
            <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              duplicate key
            </span>
          )}
          <span className="ml-auto shrink-0 text-xs text-zinc-400">
            {entry.used ? `Used ${entry.usageCount}×` : 'Unused'}
          </span>
        </div>
        {(entry.author || entry.title || entry.year) && (
          <div className="truncate text-xs text-zinc-500">
            {[entry.author, entry.title, entry.year].filter(Boolean).join(' · ')}
          </div>
        )}
        {entry.firstUsage && (
          <div className="truncate text-xs text-zinc-500">
            First: {entry.firstUsage.chapter ?? entry.firstUsage.section ?? entry.firstUsage.file}
          </div>
        )}
      </button>

      <div className="mt-1 flex gap-2">
        {entry.bibFile && (
          <button
            onClick={() => onOpen(entry.bibFile!, entry.bibLine ?? 1)}
            className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Open Bib
          </button>
        )}
        {entry.usages.length > 0 && (
          <button
            onClick={onToggle}
            className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {expanded ? 'Hide Usages' : `Show Usages (${entry.usages.length})`}
          </button>
        )}
      </div>

      {expanded &&
        entry.usages.map((u, i) => (
          <button
            key={`${u.file}:${u.line}:${i}`}
            data-usage
            onClick={() => onOpen(u.file, u.line)}
            className="mt-1 block w-full rounded bg-zinc-50 px-2 py-1 text-left hover:bg-zinc-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800"
            title={`${u.file}:${u.line}`}
          >
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 font-mono text-[11px] text-zinc-400">
                {u.file}:{u.line}
              </span>
              {(u.chapter || u.section) && (
                <span className="truncate text-[11px] text-zinc-500">
                  {[u.chapter, u.section].filter(Boolean).join(' / ')}
                </span>
              )}
            </div>
            {u.context && (
              <div className="truncate font-mono text-[11px] text-zinc-500">{u.context}</div>
            )}
          </button>
        ))}
    </div>
  );
}
