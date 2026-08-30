import { useEffect, useMemo, useRef } from 'react';
import { useSearchStore, groupMatches } from '../../stores/searchStore';
import { useEditorStore } from '../../stores/editorStore';

/**
 * Project-wide search and Replace All.
 *
 * Replace is deliberately two-step on the client as well as the server: the
 * Apply button stays disabled until a preview has produced a token, so the UI
 * cannot get ahead of the confirmation the API enforces.
 */
export function SearchPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const openFileAtLine = useEditorStore((s) => s.openFileAtLine);

  const {
    query,
    caseSensitive,
    wholeWord,
    regex,
    includeGlob,
    excludeGlob,
    results,
    searching,
    truncated,
    durationMs,
    searchedFiles,
    error,
    replacement,
    previewToken,
    previewFiles,
    previewTotal,
    previewing,
    applying,
    lastApply,
  } = useSearchStore();

  const setQuery = useSearchStore((s) => s.setQuery);
  const toggle = useSearchStore((s) => s.toggle);
  const setIncludeGlob = useSearchStore((s) => s.setIncludeGlob);
  const setExcludeGlob = useSearchStore((s) => s.setExcludeGlob);
  const setReplacement = useSearchStore((s) => s.setReplacement);
  const run = useSearchStore((s) => s.run);
  const previewReplace = useSearchStore((s) => s.previewReplace);
  const applyReplace = useSearchStore((s) => s.applyReplace);

  const grouped = useMemo(() => groupMatches(results), [results]);

  // Ctrl+Shift+F focuses this input; the panel is revealed by the same chord.
  useEffect(() => {
    const onFocusSearch = () => {
      requestAnimationFrame(() => inputRef.current?.select());
    };
    window.addEventListener('latex-studio:focus-search', onFocusSearch);
    return () => window.removeEventListener('latex-studio:focus-search', onFocusSearch);
  }, []);

  const apply = async () => {
    const ok = await applyReplace();
    if (ok) void run(); // results are stale once the files changed
  };

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void run();
        }}
        placeholder="Search in project…"
        className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
      />

      <div className="flex flex-wrap items-center gap-1 text-xs text-zinc-500">
        <Toggle label="Aa" title="Case sensitive" on={caseSensitive} onClick={() => toggle('caseSensitive')} />
        <Toggle label="[ab]" title="Whole word" on={wholeWord} onClick={() => toggle('wholeWord')} />
        <Toggle label=".*" title="Regular expression" on={regex} onClick={() => toggle('regex')} />
      </div>

      <div className="flex gap-1">
        <input
          value={includeGlob}
          onChange={(e) => setIncludeGlob(e.target.value)}
          placeholder="include glob"
          className="w-1/2 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          value={excludeGlob}
          onChange={(e) => setExcludeGlob(e.target.value)}
          placeholder="exclude glob"
          className="w-1/2 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => void run()}
          disabled={searching || !query}
          className="rounded bg-blue-600 px-2 py-1 text-[13px] font-medium text-white disabled:opacity-40"
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
        {results.length > 0 && !searching && (
          <span className="text-xs text-zinc-400">
            {results.length} in {grouped.length} file{grouped.length === 1 ? '' : 's'}
            {searchedFiles ? ` · ${searchedFiles} scanned · ${durationMs}ms` : ''}
          </span>
        )}
      </div>

      {/* ---- Replace ---- */}
      <div className="mt-1 border-t border-zinc-200 pt-2 dark:border-zinc-800">
        <input
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          placeholder="Replace with…"
          className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="mt-1 flex items-center gap-2">
          <button
            onClick={() => void previewReplace()}
            disabled={!query || previewing || searching}
            className="rounded border border-zinc-300 px-2 py-1 text-[13px] hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {previewing ? 'Previewing…' : 'Preview'}
          </button>
          <button
            onClick={() => void apply()}
            disabled={!previewToken || applying}
            title={previewToken ? undefined : 'Run a preview first'}
            className="rounded bg-amber-600 px-2 py-1 text-[13px] font-medium text-white disabled:opacity-40"
          >
            {applying ? 'Applying…' : 'Replace all'}
          </button>
          {previewToken && <span className="text-xs text-amber-600">{previewTotal} changes</span>}
        </div>

        {previewFiles.length > 0 && (
          <ul className="mt-1 max-h-24 overflow-y-auto text-xs text-zinc-500">
            {previewFiles.map((f) => (
              <li key={f.file} className="flex gap-2">
                <span className="truncate">{f.file}</span>
                <span className="ml-auto shrink-0 font-mono">{f.replacements}</span>
              </li>
            ))}
          </ul>
        )}

        {lastApply && (
          <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
            Replaced {lastApply.totalReplacements} in {lastApply.filesModified} file
            {lastApply.filesModified === 1 ? '' : 's'} · snapshot {lastApply.snapshotId}
          </p>
        )}
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {truncated && (
        <p className="text-xs text-amber-600">
          Result set was truncated — narrow the search to see everything.
        </p>
      )}

      {/* ---- Results ---- */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {grouped.map((g) => (
          <div key={g.file} className="mb-1">
            <div className="sticky top-0 bg-zinc-50 px-1 py-0.5 text-xs font-semibold text-zinc-500 dark:bg-zinc-900">
              {g.file}
              <span className="ml-1 font-normal text-zinc-400">({g.hits.length})</span>
            </div>
            {g.hits.map((m, i) => (
              <button
                key={`${m.line}:${m.column}:${i}`}
                onClick={() => void openFileAtLine(m.file, m.line)}
                title={`${m.file}:${m.line}:${m.column}`}
                className="block w-full truncate px-1 py-0.5 text-left font-mono text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <span className="mr-1 text-zinc-400">{m.line}</span>
                {m.section && <span className="mr-1 text-zinc-400">{m.section} ·</span>}
                {m.preview}
              </button>
            ))}
          </div>
        ))}
        {!searching && query && results.length === 0 && (
          <p className="px-1 py-2 text-xs text-zinc-400">No matches.</p>
        )}
      </div>
    </div>
  );
}

function Toggle({
  label,
  title,
  on,
  onClick,
}: {
  label: string;
  title: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded border px-1.5 py-0.5 font-mono ${
        on
          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
          : 'border-zinc-300 text-zinc-500 dark:border-zinc-700'
      }`}
    >
      {label}
    </button>
  );
}
