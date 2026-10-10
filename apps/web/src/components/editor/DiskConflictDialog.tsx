import { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { api } from '../../api/client';
import { useEditorStore } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';

export function DiskConflictDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const tab = useEditorStore((s) => s.tabs.find((t) => t.path === path));
  const generation = useEditorStore((s) => s.generation);
  const theme = useSettingsStore((s) => s.theme);
  const [disk, setDisk] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api.readFile(path).then((r) => { if (alive) setDisk(r.content); }).catch((err) => {
      if (!alive) return;
      if (err.code === 'FILE_NOT_FOUND') setDisk(null);
      else setError(err.message);
    });
    return () => { alive = false; };
  }, [path]);
  if (!tab) return null;
  const resolve = async (keep: boolean) => {
    if (disk === undefined || useEditorStore.getState().generation !== generation) return;
    if (!keep && !window.confirm('Discard your unsaved edits and use the disk version?')) return;
    setBusy(true);
    try {
      await useEditorStore.getState().acceptDisk(path, disk, keep);
      onClose();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <section role="dialog" aria-modal="true" aria-label="Review disk changes" className="flex h-[75vh] w-[1000px] max-w-full flex-col rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900">
        <h2 className="font-semibold">Review disk changes — {path}</h2>
        <p className="my-2 text-xs text-zinc-500">Left: current disk version{disk === null ? ' (file deleted)' : ''}. Right: your unsaved edits.</p>
        {error && <p role="alert" className="mb-2 text-sm text-red-600">{error}</p>}
        <div className="min-h-0 flex-1">
          {disk !== undefined && <DiffEditor original={disk ?? ''} modified={tab.content} language="latex" theme={dark ? 'vs-dark' : 'vs'} options={{ readOnly: true, automaticLayout: true, minimap: { enabled: false } }} />}
        </div>
        <div className="mt-3 flex justify-end gap-3 text-sm">
          <button onClick={onClose} disabled={busy}>Keep editing</button>
          <button onClick={() => void resolve(false)} disabled={busy || disk === undefined} className="rounded border px-3 py-1">Use disk version</button>
          <button onClick={() => void resolve(true)} disabled={busy || disk === undefined} className="rounded bg-blue-600 px-3 py-1 text-white">Save my version</button>
        </div>
      </section>
    </div>
  );
}
