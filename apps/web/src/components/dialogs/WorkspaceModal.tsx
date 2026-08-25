import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

type Mode = 'open' | 'create';

interface RecentItem {
  path: string;
  name: string;
  lastOpened: number;
}

interface TemplateItem {
  id: string;
  name: string;
  description?: string;
  mainFile: string;
}

export function WorkspaceModal() {
  const open = useUiStore((s) => s.workspaceModalOpen);
  const setOpen = useUiStore((s) => s.setWorkspaceModalOpen);
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const currentPath = useWorkspaceStore((s) => s.path);

  const [mode, setMode] = useState<Mode>('open');
  const [path, setPath] = useState(currentPath ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [recents, setRecents] = useState<RecentItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [templateId, setTemplateId] = useState<string>('article');
  const [newDir, setNewDir] = useState('');
  const [parentDir, setParentDir] = useState('');

  useEffect(() => {
    if (!open) return;
    setError(null);
    api.recentProjects().then((r) => setRecents(r.recents)).catch(() => {});
    api.templates().then((r) => setTemplates(r.templates)).catch(() => {});
  }, [open]);

  if (!open) return null;

  const submitOpen = async () => {
    if (!path.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await openWorkspace(path.trim());
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async () => {
    if (!templateId || !parentDir.trim()) return;
    const name = newDir.trim() || templateId;
    const target = `${parentDir.replace(/[\\/]+$/, '')}\\${name}`;
    setBusy(true);
    setError(null);
    try {
      await api.createFromTemplate(templateId, target);
      await openWorkspace(target);
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[520px] max-w-[92vw] rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-base font-semibold">Workspace</h2>

        {/* mode switch */}
        <div className="mb-4 flex gap-1 text-xs">
          {(['open', 'create'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`rounded px-2 py-1 ${
                mode === m
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
              }`}
            >
              {m === 'open' ? 'Open existing' : 'New from template'}
            </button>
          ))}
        </div>

        {mode === 'open' ? (
          <>
            <input
              autoFocus
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitOpen();
                if (e.key === 'Escape') setOpen(false);
              }}
              placeholder="e.g. D:\Research\thesis"
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-blue-500 dark:border-zinc-600"
            />
            {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                disabled={busy || !path.trim()}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                onClick={() => void submitOpen()}
              >
                Open
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="mb-1 block text-xs text-zinc-500">Template</label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="mb-3 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-zinc-600"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.description ? ` — ${t.description}` : ''}
                </option>
              ))}
            </select>
            <label className="mb-1 block text-xs text-zinc-500">Parent directory</label>
            <input
              value={parentDir}
              onChange={(e) => setParentDir(e.target.value)}
              placeholder="e.g. D:\Research"
              className="mb-2 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-blue-500 dark:border-zinc-600"
            />
            <label className="mb-1 block text-xs text-zinc-500">Project folder name</label>
            <input
              value={newDir}
              onChange={(e) => setNewDir(e.target.value)}
              placeholder="my-paper"
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-blue-500 dark:border-zinc-600"
            />
            {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                disabled={busy || !parentDir.trim()}
                className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                onClick={() => void submitCreate()}
              >
                Create & Open
              </button>
            </div>
          </>
        )}

        {mode === 'open' && recents.length > 0 && (
          <>
            <div className="mt-4 mb-1 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
              Recent Projects
            </div>
            <div className="max-h-36 overflow-y-auto">
              {recents.map((r) => (
                <button
                  key={r.path}
                  onClick={async () => {
                    setPath(r.path);
                    await openWorkspace(r.path).then(() => setOpen(false)).catch(() => {});
                  }}
                  title={r.path}
                  className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="font-medium">{r.name}</span>
                  <span className="truncate font-mono text-[10px] text-zinc-400">{r.path}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
