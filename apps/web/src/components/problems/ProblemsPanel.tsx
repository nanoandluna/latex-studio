import { useBuildStore } from '../../stores/buildStore';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import { useProjectIndexStore } from '../../stores/projectIndexStore';
import { useMemo } from 'react';
import type { Problem } from '@latex-studio/shared';

export function ProblemsPanel() {
  const index = useProjectIndexStore((s) => s.index);
  const buildProblems = useBuildStore((s) => s.problems);

  const log = useBuildStore((s) => s.log);
  const status = useBuildStore((s) => s.status);
  const durationMs = useBuildStore((s) => s.durationMs);
  const clearLog = useBuildStore((s) => s.clearLog);
  const notice = useBuildStore((s) => s.notice);
  const bottomTab = useUiStore((s) => s.bottomTab);
  const setBottomTab = useUiStore((s) => s.setBottomTab);

  // Merge compiler problems with live project-index diagnostics.
  // NOTE: diagnostics are derived via useMemo — subscribing with an inline
  // s.index?.diagnostics ?? [] selector allocates a fresh array per store
  // event and causes render storms (React #185).
  const indexDiags = useMemo(() => index?.diagnostics ?? [], [index]);
  const problems: (Problem & { source: 'build' | 'index' })[] = [
    ...buildProblems.map((p) => ({ ...p, source: 'build' as const })),
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

  const statusText =
    status === 'running' || status === 'starting' || status === 'queued'
      ? '◌ Building…'
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
        : status === 'running' || status === 'starting' || status === 'queued'
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
        {notice && (
          <span
            className="rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-200"
            title={notice}
          >
            {notice}
          </span>
        )}
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
          <pre className="h-full overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">
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
        <span className="shrink-0 rounded bg-zinc-200 px-1 text-[10px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
          index
        </span>
      )}
      <span className="ml-auto shrink-0 pl-2 font-mono text-[11px] text-zinc-400">
        {problem.file ?? ''}
        {problem.line ? `:${problem.line}` : ''}
      </span>
    </button>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
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
