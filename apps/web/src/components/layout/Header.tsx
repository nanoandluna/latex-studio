import { useEffect, useState } from 'react';
import type { LatexEnvironment } from '@latex-studio/shared';
import { api } from '../../api/client';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useBuildStore } from '../../stores/buildStore';
import { useSettingsStore, type CompilerChoice, type AutoSavePolicy } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';

const COMPILERS: CompilerChoice[] = ['auto', 'latexmk', 'xelatex', 'pdflatex', 'lualatex'];
const COMPILER_LABELS: Record<CompilerChoice, string> = {
  auto: 'Auto',
  latexmk: 'LaTeXmk',
  xelatex: 'XeLaTeX',
  pdflatex: 'pdfLaTeX',
  lualatex: 'LuaLaTeX',
};

export function Header() {
  const name = useWorkspaceStore((s) => s.name);
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
  const status = useBuildStore((s) => s.status);
  const build = useBuildStore((s) => s.build);
  const cancel = useBuildStore((s) => s.cancel);
  const openModal = useUiStore((s) => s.setWorkspaceModalOpen);
  const toggleExplorer = useUiStore((s) => s.toggleExplorer);

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-zinc-200 px-3 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-blue-600 dark:text-blue-400">TeX</span>
        <span className="text-sm font-semibold">Studio</span>
      </div>

      {name ? (
        <button
          className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          onClick={() => openModal(true)}
          title="Change workspace"
        >
          📁 {name}
        </button>
      ) : (
        <button
          className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500"
          onClick={() => openModal(true)}
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

      {mainFile && (
        <label className="hidden items-center gap-1 text-xs text-zinc-500 md:flex" title="Main file (used for compilation)">
          Main:
          <input
            value={mainFile}
            onChange={(e) => setMainFile(e.target.value || null)}
            className="w-36 rounded border border-zinc-200 bg-transparent px-1.5 py-0.5 font-mono outline-none focus:border-blue-500 dark:border-zinc-700"
          />
        </label>
      )}

      <select
        value={compiler}
        onChange={(e) => setCompiler(e.target.value as CompilerChoice)}
        className="rounded border border-zinc-200 bg-transparent px-1.5 py-0.5 text-xs outline-none focus:border-blue-500 dark:border-zinc-700"
        title="Compiler"
      >
        {COMPILERS.map((c) => (
          <option key={c} value={c}>
            {COMPILER_LABELS[c]}
          </option>
        ))}
      </select>

      <label
        className="hidden cursor-pointer items-center gap-1 text-xs text-zinc-500 select-none sm:flex"
        title="Automatically rebuild ~1s after each save"
      >
        <input type="checkbox" checked={autoCompile} onChange={(e) => setAutoCompile(e.target.checked)} />
        Auto Compile
      </label>

      <select
        value={autoSave}
        onChange={(e) => setAutoSave(e.target.value as AutoSavePolicy)}
        className="hidden rounded border border-zinc-200 bg-transparent px-1.5 py-0.5 text-xs outline-none focus:border-blue-500 md:block dark:border-zinc-700"
        title="Auto-save dirty files: off / every 30 seconds / when the window loses focus"
      >
        <option value="off">Auto save: Off</option>
        <option value="interval">Auto save: 30 s</option>
        <option value="focus-loss">Auto save: On blur</option>
      </select>

      <label
        className="hidden cursor-pointer items-center gap-1 text-xs text-zinc-500 select-none md:flex"
        title="When the window loses focus with unsaved edits, take an `auto` snapshot (see History)"
      >
        <input
          type="checkbox"
          checked={autoSnapshot}
          onChange={(e) => setAutoSnapshot(e.target.checked)}
        />
        Snap on blur
      </label>

      <EnvBadge />

      {status === 'running' || status === 'starting' || status === 'queued' ? (
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

      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value as typeof theme)}
        className="rounded border border-zinc-200 bg-transparent px-1 py-0.5 text-xs outline-none dark:border-zinc-700"
        title="Theme"
      >
        <option value="dark">Dark</option>
        <option value="light">Light</option>
        <option value="system">System</option>
      </select>
    </header>
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
    <span className="flex max-w-md items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <span>⚠ No LaTeX environment detected. Install TeX Live or MiKTeX and restart.</span>
      <button className="shrink-0 opacity-60 hover:opacity-100" onClick={dismiss}>
        ×
      </button>
    </span>
  );
}
