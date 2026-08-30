import { useEffect, useRef, useState } from 'react';
import { DiffEditor, loader } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import * as monacoNs from 'monaco-editor';
import { api } from '../../api/client';
import { useUiStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { registerLatexLanguage, LATEX_LANG_ID } from '../../editor/latexLanguage';
import { editorTokens } from '../../editor/tokens';
import type { SnapshotDiffEntry } from '@latex-studio/shared';

loader.config({ monaco: monacoNs });

/**
 * Below this container width the diff switches from side-by-side to unified.
 * At the common 1440×900 layout the diff body is only ~490 px wide (sidebar +
 * PDF preview flank it), so unified is the honest default there; side-by-side
 * appears once the pane is genuinely wide enough for two text columns.
 */
const UNIFIED_BELOW = 720;

/**
 * Snapshot diff as a read-only view in the main editor area: a CHANGES rail
 * for navigating the files touched by the snapshot, and a Monaco DiffEditor
 * (snapshot ↔ working tree). Closing the tab mutates nothing.
 */
export function DiffWorkspace() {
  const session = useUiStore((s) => s.diffSession);
  const theme = useSettingsStore((s) => s.theme);
  const dark =
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const [entries, setEntries] = useState<SnapshotDiffEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [unified, setUnified] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setEntries(null);
    setError(null);
    api
      .snapshotDiff(session.snapshotId)
      .then((res) => {
        if (cancelled) return;
        setEntries(res.entries);
        const initial =
          res.entries.find((e) => e.path === session.initialPath) ??
          res.entries.find((e) => !e.binary && e.status === 'M') ??
          res.entries.find((e) => !e.binary) ??
          res.entries[0];
        setActiveFile(initial?.path ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message || 'Could not load the diff');
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Side-by-side only while there is room for two columns; unified otherwise.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver((rs) => {
      for (const r of rs) setUnified(r.contentRect.width < UNIFIED_BELOW);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!session) return null;

  const active = entries?.find((e) => e.path === activeFile) ?? null;
  const tokens = editorTokens();

  let body: React.ReactNode;
  if (error) {
    body = <Centered>{error}</Centered>;
  } else if (!entries) {
    body = <Centered>Comparing…</Centered>;
  } else if (entries.length === 0) {
    body = <Centered>No differences — the workspace matches this snapshot.</Centered>;
  } else if (!active) {
    body = <Centered>Select a file from the changes list.</Centered>;
  } else if (active.binary || (active.snapshotContent == null && active.currentContent == null)) {
    body = <Centered>Binary file — content not shown ({active.path}).</Centered>;
  } else {
    body = (
      <DiffEditor
        height="100%"
        language={LATEX_LANG_ID}
        theme={dark ? 'latex-studio-dark' : 'vs'}
        original={active.snapshotContent ?? ''}
        modified={active.currentContent ?? ''}
        beforeMount={(monaco) => registerLatexLanguage(monaco as unknown as typeof Monaco)}
        options={{
          readOnly: true,
          renderSideBySide: !unified,
          fontSize: tokens.fontSize,
          lineHeight: tokens.lineHeight,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          padding: { top: 8 },
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 text-xs text-zinc-500 dark:border-zinc-800">
        <span className="font-medium text-zinc-600 dark:text-zinc-300">
          Snapshot ↔ Working tree
        </span>
        <span className="truncate text-zinc-400">{session.label}</span>
        <span className="ml-auto shrink-0 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          read-only
        </span>
        {!unified && entries && entries.length > 0 && (
          <span className="hidden shrink-0 text-[10px] text-zinc-400 lg:inline">side-by-side</span>
        )}
        {unified && entries && entries.length > 0 && (
          <span className="hidden shrink-0 text-[10px] text-zinc-400 lg:inline">unified</span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside data-testid="diff-changes" className="w-56 shrink-0 overflow-y-auto border-r border-zinc-200 dark:border-zinc-800">
          <p className="px-2 pt-2 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
            Changes
          </p>
          {(entries ?? []).map((e) => (
            <button
              key={e.path}
              onClick={() => setActiveFile(e.path)}
              className={`flex w-full items-baseline gap-2 px-2 py-1 text-left text-[13px] hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                e.path === activeFile ? 'bg-zinc-100 dark:bg-zinc-800/70' : ''
              }`}
            >
              <span
                className={`shrink-0 font-mono text-xs ${
                  e.status === 'M'
                    ? 'text-amber-600'
                    : e.status === 'A'
                      ? 'text-emerald-600'
                      : 'text-red-600'
                }`}
                title={e.status === 'M' ? 'Modified' : e.status === 'A' ? 'Added on disk' : 'Deleted on disk'}
              >
                {e.status}
              </span>
              <span className="truncate">{e.path}</span>
            </button>
          ))}
          {entries !== null && entries.length === 0 && (
            <p className="px-2 py-2 text-[13px] text-zinc-400">Nothing changed.</p>
          )}
        </aside>
        <div ref={bodyRef} data-view={unified ? 'unified' : 'side-by-side'} className="min-w-0 flex-1">
          {body}
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-zinc-400">
      {children}
    </div>
  );
}
