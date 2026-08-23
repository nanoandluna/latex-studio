import { useState } from 'react';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

export function WorkspaceModal() {
  const open = useUiStore((s) => s.workspaceModalOpen);
  const setOpen = useUiStore((s) => s.setWorkspaceModalOpen);
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const currentPath = useWorkspaceStore((s) => s.path);
  const [path, setPath] = useState(currentPath ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async () => {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
      <div
        className="w-[480px] max-w-[90vw] rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-base font-semibold">Open LaTeX Workspace</h2>
        <p className="mb-4 text-xs text-zinc-500">
          Enter the absolute path of a local folder containing your .tex project.
        </p>
        <input
          autoFocus
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder="e.g. D:\Projects\my-paper"
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
            onClick={() => void submit()}
          >
            {busy ? 'Opening…' : 'Open'}
          </button>
        </div>
      </div>
    </div>
  );
}
