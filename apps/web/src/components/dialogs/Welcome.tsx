import { useEffect, useState } from 'react';
import type { LatexEnvironment } from '@latex-studio/shared';
import { api } from '../../api/client';
import { useUiStore } from '../../stores/uiStore';

export function Welcome() {
  const openModal = useUiStore((s) => s.setWorkspaceModalOpen);
  const [env, setEnv] = useState<LatexEnvironment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = () => { setError(null); api.env(true).then(setEnv).catch((e) => setError(e.message)); };
  useEffect(check, []);
  return <div data-testid="welcome" className="flex flex-1 flex-col items-center justify-center gap-5 overflow-auto px-6 py-8">
    <div className="text-center">
      <p className="mb-3 text-xs font-medium uppercase tracking-[0.25em] text-zinc-400">Research writing · V1.0</p>
      <h1 className="text-4xl font-semibold tracking-tight"><span className="text-blue-600 dark:text-blue-400">LaTeX</span> Studio</h1>
      <p className="mt-3 max-w-lg text-sm leading-relaxed text-zinc-500">Your paper, on your computer. Edit, compile, read and manage citations in one local workspace.</p>
    </div>
    <button onClick={() => openModal(true)} className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-500">Open Workspace…</button>
    <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-3">
      {[
        ['1 · Start a paper', 'Open a project folder, or create an article, thesis or presentation from a template.'],
        ['2 · Write with confidence', 'Ctrl+S saves. Unsaved drafts recover after reload. Ctrl+Shift+S captures a snapshot.'],
        ['3 · Compile and read', 'Ctrl+B saves all edited files and builds the PDF. Ctrl+Click jumps between source and PDF.'],
      ].map(([title, text]) => <div key={title} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"><h2 className="mb-2 text-sm font-medium">{title}</h2><p className="text-xs leading-relaxed text-zinc-500">{text}</p></div>)}
    </div>
    <section aria-label="LaTeX environment" className="w-full max-w-2xl rounded-xl border border-zinc-200 p-4 text-xs dark:border-zinc-800">
      <div className="flex items-center justify-between"><h2 className="font-medium">{env ? env.anyAvailable ? 'LaTeX environment ready' : 'Set up a LaTeX compiler' : 'Checking your LaTeX environment…'}</h2><button onClick={check} className="text-blue-600 hover:underline">Check again</button></div>
      <p className="mt-2 text-zinc-500">{error ?? (env?.anyAvailable ? env.tools.filter((t) => t.available).map((t) => t.name).join(' · ') : 'Install TeX Live or MiKTeX, then restart the server. You can edit and inspect projects before installing a compiler.')}</p>
    </section>
    <p className="text-xs text-zinc-400">Ctrl+Shift+P opens the command palette · No account required</p>
  </div>;
}
