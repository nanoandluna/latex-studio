import { useEffect, useState } from 'react';
import type { LatexEnvironment } from '@latex-studio/shared';
import { api } from '../../api/client';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useBuildStore } from '../../stores/buildStore';
import {
  useSettingsStore,
  type CompilerChoice,
  type AutoSavePolicy,
} from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { showPanel } from '../../hooks/useHotkeys';

const COMPILERS: CompilerChoice[] = ['auto', 'latexmk', 'xelatex', 'pdflatex', 'lualatex'];
const COMPILER_LABELS: Record<CompilerChoice, string> = {
  auto: 'Auto',
  latexmk: 'LaTeXmk',
  xelatex: 'XeLaTeX',
  pdflatex: 'pdfLaTeX',
  lualatex: 'LuaLaTeX',
};

/**
 * V0.4.2 header: only the high-frequency core stays visible — workspace,
 * project search, build — plus a single settings menu for everything
 * low-frequency (compiler, main file, auto-save, theme, environment).
 */
export function Header() {
  const name = useWorkspaceStore((s) => s.name);
  const status = useBuildStore((s) => s.status);
  const build = useBuildStore((s) => s.build);
  const cancel = useBuildStore((s) => s.cancel);
  const toggleExplorer = useUiStore((s) => s.toggleExplorer);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const building = status === 'running' || status === 'starting' || status === 'queued';

  return (
    <header className="relative flex h-11 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-blue-600 dark:text-blue-400">TeX</span>
        <span className="text-sm font-semibold">Studio</span>
      </div>

      {name ? (
        <button
          className="max-w-[220px] truncate rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          onClick={() => useUiStore.getState().setWorkspaceModalOpen(true)}
          title="Change workspace"
        >
          📁 {name}
        </button>
      ) : (
        <button
          className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500"
          onClick={() => useUiStore.getState().setWorkspaceModalOpen(true)}
        >
          Open Workspace
        </button>
      )}

      <button
        className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        onClick={toggleExplorer}
        title="Toggle Explorer"
      >
        ☰
      </button>

      <div className="flex-1" />

      <button
        onClick={() => showPanel('search')}
        disabled={!name}
        title="Search in project (Ctrl+Shift+F)"
        aria-label="Search in project"
        className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        🔍
      </button>

      {building ? (
        <button
          onClick={() => void cancel()}
          className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500"
        >
          Cancel
        </button>
      ) : (
        <button
          onClick={() => void build()}
          disabled={!name}
          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          title="Ctrl+B"
        >
          Build ▶
        </button>
      )}

      <div className="relative">
        <button
          onClick={() => setSettingsOpen((v) => !v)}
          aria-label="Settings"
          title="Settings"
          className={`rounded-md border px-2 py-1 text-xs ${
            settingsOpen
              ? 'border-blue-400 text-zinc-900 dark:text-zinc-100'
              : 'border-zinc-200 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
          }`}
        >
          ⚙
        </button>
        {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      </div>
    </header>
  );
}

/** Low-frequency settings, gathered in one popover instead of the header row. */
function SettingsPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const mainFile = useWorkspaceStore((s) => s.mainFile);
  const setMainFile = useWorkspaceStore((s) => s.setMainFile);
  const compiler = useSettingsStore((s) => s.compiler);
  const setCompiler = useSettingsStore((s) => s.setCompiler);
  const autoCompile = useSettingsStore((s) => s.autoCompile);
  const setAutoCompile = useSettingsStore((s) => s.setAutoCompile);
  const autoSave = useSettingsStore((s) => s.autoSave);
  const setAutoSave = useSettingsStore((s) => s.setAutoSave);
  const autoSnapshot = useSettingsStore((s) => s.autoSnapshot);
  const setAutoSnapshot = useSettingsStore((s) => s.setAutoSnapshot);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-9 z-50 w-80 space-y-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">Build</p>
        <label className="flex items-center justify-between gap-2 text-[13px]">
          <span className="text-zinc-500">Main file</span>
          <input
            value={mainFile ?? ''}
            onChange={(e) => setMainFile(e.target.value || null)}
            placeholder="main.tex"
            className="w-44 rounded border border-zinc-200 bg-transparent px-1.5 py-0.5 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-[13px]">
          <span className="text-zinc-500">Compiler</span>
          <select
            value={compiler}
            onChange={(e) => setCompiler(e.target.value as CompilerChoice)}
            className="rounded border border-zinc-200 bg-transparent px-1.5 py-0.5 text-xs outline-none focus:border-blue-500 dark:border-zinc-700"
          >
            {COMPILERS.map((c) => (
              <option key={c} value={c}>
                {COMPILER_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label
          className="flex cursor-pointer items-center justify-between gap-2 text-[13px] select-none"
          title="Automatically rebuild ~1s after each save"
        >
          <span className="text-zinc-500">Auto Compile</span>
          <input
            type="checkbox"
            checked={autoCompile}
            onChange={(e) => setAutoCompile(e.target.checked)}
          />
        </label>

        <p className="pt-1 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
          Writing safety
        </p>
        <label className="flex items-center justify-between gap-2 text-[13px]">
          <span className="text-zinc-500" title="Auto-save dirty files periodically or on focus loss">
            Auto save
          </span>
          <select
            value={autoSave}
            onChange={(e) => setAutoSave(e.target.value as AutoSavePolicy)}
            className="rounded border border-zinc-200 bg-transparent px-1.5 py-0.5 text-xs outline-none focus:border-blue-500 dark:border-zinc-700"
            title="Auto-save dirty files: off / every 30 seconds / when the window loses focus"
          >
            <option value="off">Off</option>
            <option value="interval">Every 30 s</option>
            <option value="focus-loss">On focus loss</option>
          </select>
        </label>
        <label
          className="flex cursor-pointer items-center justify-between gap-2 text-[13px] select-none"
          title="When the window loses focus with unsaved edits, take an `auto` snapshot (see History)"
        >
          <span className="text-zinc-500">Snapshot on focus loss</span>
          <input
            type="checkbox"
            checked={autoSnapshot}
            onChange={(e) => setAutoSnapshot(e.target.checked)}
          />
        </label>

        <p className="pt-1 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
          Appearance
        </p>
        <label className="flex items-center justify-between gap-2 text-[13px]">
          <span className="text-zinc-500">Theme</span>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as typeof theme)}
            className="rounded border border-zinc-200 bg-transparent px-1.5 py-0.5 text-xs outline-none dark:border-zinc-700"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
        </label>

        <div className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <EnvBadge />
        </div>
      </div>
    </>
  );
}

function EnvBadge() {
  const [env, setEnv] = useState<LatexEnvironment | null>(null);
  const dismissed = useUiStore((s) => s.envWarningDismissed);
  const dismiss = useUiStore((s) => s.dismissEnvWarning);

  useEffect(() => {
    api.env().then(setEnv).catch(() => {});
  }, []);

  if (!env) return null;
  const toolTip = (t: LatexEnvironment['tools'][number]) =>
    `${t.available ? '✓' : '✕'} ${t.name}${t.path ? `\n    ${t.path}` : ''}${t.version ? `\n    ${t.version}` : ''}`;
  const summary = env.tools.map(toolTip).join('\n');

  if (env.anyAvailable) {
    return (
      <span
        className="cursor-help text-xs text-emerald-600 dark:text-emerald-400"
        title={`${summary}${env.distribution ? `\nDistribution: ${env.distribution}` : ''}`}
      >
        ✓ LaTeX{env.distribution ? ` · ${env.distribution}` : ''}
      </span>
    );
  }
  if (dismissed) return null;
  return (
    <span className="flex max-w-md items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs leading-snug text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <span>⚠ No LaTeX environment detected. Install TeX Live or MiKTeX and restart.</span>
      <button className="shrink-0 opacity-60 hover:opacity-100" onClick={dismiss}>
        ×
      </button>
    </span>
  );
}
