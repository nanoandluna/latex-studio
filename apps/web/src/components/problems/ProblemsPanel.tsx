import { useBuildStore } from '../../stores/buildStore';
import { useEditorStore, documentSaveState } from '../../stores/editorStore';
import { useSnapshotStore } from '../../stores/snapshotStore';
import { useUiStore } from '../../stores/uiStore';
import { useProjectIndexStore } from '../../stores/projectIndexStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useEffect, useMemo, useState } from 'react';
import type { Problem } from '@latex-studio/shared';

export function ProblemsPanel() {
  const index = useProjectIndexStore((s) => s.index);
  const writingChecksEnabled = useSettingsStore((s) => s.writingChecks);
  const setWritingChecks = useSettingsStore((s) => s.setWritingChecks);
  const [writing, setWriting] = useState<import('@latex-studio/shared').WritingDiagnostic[]>([]);
  const [termHits, setTermHits] = useState<import('@latex-studio/shared').TerminologyHit[]>([]);
  const buildProblems = useBuildStore((s) => s.problems);

  const log = useBuildStore((s) => s.log);
  const status = useBuildStore((s) => s.status);
  const durationMs = useBuildStore((s) => s.durationMs);
  const startedAt = useBuildStore((s) => s.startedAt);
  const clearLog = useBuildStore((s) => s.clearLog);
  const notice = useBuildStore((s) => s.notice);
  const compiler = useSettingsStore((s) => s.compiler);
  const bottomTab = useUiStore((s) => s.bottomTab);
  const setBottomTab = useUiStore((s) => s.setBottomTab);

  // Elapsed ticker while a build runs — real wall-clock time, never a fake
  // percentage (latexmk cannot report honest progress).
  const building = status === 'running' || status === 'starting' || status === 'queued';
  const [, tickBuild] = useState(0);
  useEffect(() => {
    if (!building) return;
    const t = setInterval(() => tickBuild((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [building]);
  const elapsed = building && startedAt ? ` · ${((Date.now() - startedAt) / 1000).toFixed(1)}s` : '';

  // Merge compiler problems with live project-index diagnostics.
  // NOTE: diagnostics are derived via useMemo — subscribing with an inline
  // s.index?.diagnostics ?? [] selector allocates a fresh array per store
  // event and causes render storms (React #185).
  const indexDiags = useMemo(() => index?.diagnostics ?? [], [index]);

  // V0.3 rule-based writing checks (toggleable, info-tier)
  useEffect(() => {
    if (!writingChecksEnabled || !index) {
      setWriting([]);
      return;
    }
    let cancelled = false;
    import('../../api/client').then(({ api }) =>
      api.writingChecks().then((r) => {
        if (!cancelled) setWriting(r.diagnostics);
      }).catch(() => {})
    );
    return () => { cancelled = true; };
  }, [writingChecksEnabled, index]);

  // V0.5 terminology consistency hits (warning-tier, same toggle)
  useEffect(() => {
    if (!writingChecksEnabled || !index) {
      setTermHits([]);
      return;
    }
    let cancelled = false;
    import('../../api/client').then(({ api }) =>
      api.terminologyHits().then((r) => {
        if (!cancelled) setTermHits(r.hits);
      }).catch(() => {})
    );
    return () => { cancelled = true; };
  }, [writingChecksEnabled, index]);
  const problems: (Problem & { source: 'build' | 'index' })[] = [
    ...buildProblems.map((p) => ({ ...p, source: 'build' as const })),
    ...termHits.map((h) => ({
      severity: 'warning' as const,
      message: `[terminology] "${h.matched}" → ${h.preferred}${h.forbidden ? ' (forbidden)' : ''}`,
      file: h.file,
      line: h.line,
      source: 'index' as const,
    })),
    ...writing.map((d) => ({
      severity: d.severity,
      message: `[writing] ${d.message} (${d.code})`,
      file: d.file,
      line: d.line,
      source: 'index' as const,
    })),
    ...indexDiags.map((d) => ({
      severity: d.severity,
      message: d.message,
      file: d.file,
      line: d.line,
      source: 'index' as const,
    })),
  ];
  const errors = problems.filter((p) => p.severity === 'error');
  const warnings = problems.filter((p) => p.severity === 'warning');

  const healthScore = useMemo(() => {
    let score = 100;
    for (const p of problems) {
      if (p.severity === 'error') score -= 10;
      else if (p.severity === 'warning') score -= 3;
      else score -= 1;
    }
    return Math.max(0, score);
  }, [problems]);

  const statusText = building
    ? `◌ Building · ${compiler}${elapsed}…`
    : status === 'success'
      ? `✓ Build successful · ${(durationMs / 1000).toFixed(2)}s`
      : status === 'failed'
        ? `✕ Build failed · ${(durationMs / 1000).toFixed(2)}s`
        : status === 'timeout'
          ? `⏱ Build timed out${durationMs ? ` after ${(durationMs / 1000).toFixed(1)}s` : ''}`
          : status === 'cancelled'
            ? '○ Build cancelled'
            : status === 'compiler_unavailable'
              ? '✕ No LaTeX compiler found'
              : '● Ready';

  const statusColor =
    status === 'success'
      ? 'text-emerald-600 dark:text-emerald-400'
      : status === 'failed' || status === 'timeout' || status === 'compiler_unavailable'
        ? 'text-red-600 dark:text-red-400'
        : building
          ? 'text-blue-600 dark:text-blue-400'
          : 'text-zinc-500';

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-zinc-200 px-2 text-xs dark:border-zinc-800">
        <TabBtn active={bottomTab === 'problems'} onClick={() => setBottomTab('problems')}>
          Problems
          {errors.length > 0 && <span className="ml-1 text-red-500">✕ {errors.length}</span>}
          {warnings.length > 0 && <span className="ml-1 text-amber-500">⚠ {warnings.length}</span>}
        </TabBtn>
        <TabBtn active={bottomTab === 'output'} onClick={() => setBottomTab('output')}>
          Output
        </TabBtn>
        <span className={`mx-2 font-medium ${statusColor}`}>{statusText}</span>
        <SaveChip />
        <SnapshotChip />
        {notice && (
          <span
            className="rounded bg-amber-100 px-2 py-0.5 text-[13px] text-amber-800 dark:bg-amber-950 dark:text-amber-200"
            title={notice}
          >
            {notice}
          </span>
        )}
        <label
          className="ml-auto flex cursor-pointer items-center gap-1 text-xs text-zinc-500 select-none"
          title="Rule-based academic writing checks (local, no AI)"
        >
          <input
            type="checkbox"
            checked={writingChecksEnabled}
            onChange={(e) => setWritingChecks(e.target.checked)}
          />
          Writing checks
        </label>
        <span
          className="rounded px-1.5 py-0.5 font-mono text-xs text-zinc-500"
          title="Health = 100 − 10×errors − 3×warnings − 1×info (deterministic)"
        >
          Health {healthScore}
        </span>
        <div className="flex-1" />
        {bottomTab === 'output' && (
          <button className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" onClick={clearLog}>
            Clear
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {bottomTab === 'problems' ? (
          problems.length === 0 ? (
            <Empty>No problems detected.</Empty>
          ) : (
            problems.map((p, i) => <ProblemRow key={i} problem={p} />)
          )
        ) : (
          <pre className="h-full overflow-auto px-3 py-2 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">
            {log || '(no build output yet — press Ctrl+B to build)'}
          </pre>
        )}
      </div>
    </div>
  );
}

function ProblemRow({ problem }: { problem: { severity: string; message: string; file?: string; line?: number; source?: 'build' | 'index' } }) {
  const openFileAtLine = useEditorStore((s) => s.openFileAtLine);
  const icon = problem.severity === 'error' ? '✕' : problem.severity === 'warning' ? '⚠' : 'ℹ';
  const color =
    problem.severity === 'error'
      ? 'text-red-500'
      : problem.severity === 'warning'
        ? 'text-amber-500'
        : 'text-blue-500';
  return (
    <button
      onClick={() => void openFileAtLine(problem.file ?? 'main.tex', Math.max(1, problem.line ?? 1))}
      className="flex w-full items-center gap-2 border-b border-zinc-100 px-3 py-1 text-left text-xs hover:bg-zinc-100 dark:border-zinc-800/50 dark:hover:bg-zinc-800"
    >
      <span className={`${color} w-4 shrink-0`}>{icon}</span>
      <span className="shrink-0 text-zinc-400 uppercase">{problem.severity}</span>
      <span className="truncate">{problem.message}</span>
      {problem.source === 'index' && (
        <span className="shrink-0 rounded bg-zinc-200 px-1 text-xs text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
          index
        </span>
      )}
      <span className="ml-auto shrink-0 pl-2 font-mono text-[13px] text-zinc-400">
        {problem.file ?? ''}
        {problem.line ? `:${problem.line}` : ''}
      </span>
    </button>
  );
}

/** "Is my thesis safe right now?" — save state of the open tabs. */
function SaveChip() {
  const tabs = useEditorStore((s) => s.tabs);
  const isDirty = useEditorStore((s) => s.isDirty);
  const saving = useEditorStore((s) => s.saving);
  const lastSaveError = useEditorStore((s) => s.lastSaveError);
  if (tabs.length === 0) return null;
  const state = documentSaveState({ saving, lastSaveError, tabs, isDirty });
  if (state === 'saving') {
    return <span className="text-blue-600 dark:text-blue-400">◌ Saving…</span>;
  }
  if (state === 'error') {
    return (
      <span className="text-red-600 dark:text-red-400" title={lastSaveError ?? undefined}>
        ✕ Save failed
      </span>
    );
  }
  if (state === 'dirty') {
    return (
      <span className="text-amber-600 dark:text-amber-400" title="Ctrl+S to save">
        ● Unsaved changes
      </span>
    );
  }
  return <span className="text-zinc-400">✓ Saved</span>;
}

/** Age of the most recent snapshot — honesty first: no snapshot, no "Safe". */
function SnapshotChip() {
  const newest = useSnapshotStore((s) => s.snapshots[0]);
  // re-render every 30 s so the relative age stays honest
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  void tick;
  if (!newest) {
    return <span className="text-zinc-400">No snapshot yet</span>;
  }
  return (
    <span
      className="text-zinc-400"
      title={`Last snapshot: ${new Date(newest.createdAt).toLocaleString()} (${newest.reason})`}
    >
      Snapshot {relativeTime(newest.createdAt)}
    </span>
  );
}

function relativeTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-0.5 font-medium ${
        active
          ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
          : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-2 text-xs text-zinc-400">{children}</div>;
}
