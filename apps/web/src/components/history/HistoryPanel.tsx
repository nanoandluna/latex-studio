import { useEffect, useMemo, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import * as monacoNs from 'monaco-editor';
import { useSnapshotStore, reasonLabel, formatWhen } from '../../stores/snapshotStore';
import { registerLatexLanguage, LATEX_LANG_ID } from '../../editor/latexLanguage';

// Same offline bundle as the main editor.
loader.config({ monaco: monacoNs });

/**
 * Snapshot history.
 *
 * Restoring rewrites files on disk, so it is always a two-click action: the
 * first click arms the button, the second confirms. There is no single-click
 * restore anywhere in this panel.
 */
export function HistoryPanel() {
  const {
    snapshots,
    loading,
    error,
    selectedId,
    diff,
    diffLoading,
    openDiffPath,
    creating,
    restoringId,
    lastRestore,
  } = useSnapshotStore();

  const refresh = useSnapshotStore((s) => s.refresh);
  const create = useSnapshotStore((s) => s.create);
  const select = useSnapshotStore((s) => s.select);
  const openDiff = useSnapshotStore((s) => s.openDiff);
  const restore = useSnapshotStore((s) => s.restore);
  const remove = useSnapshotStore((s) => s.remove);

  const [armedId, setArmedId] = useState<string | null>(null);
  const [label, setLabel] = useState('');

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Disarm whenever the selection changes, so a stray second click elsewhere
  // can never fire a restore that was armed for a different snapshot.
  useEffect(() => {
    setArmedId(null);
  }, [selectedId]);

  const selected = snapshots.find((s) => s.snapshotId === selectedId) ?? null;
  const activeEntry = useMemo(
    () => diff.find((d) => d.path === openDiffPath) ?? null,
    [diff, openDiffPath]
  );

  if (openDiffPath && activeEntry) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-zinc-200 px-2 py-1 dark:border-zinc-800">
          <button
            onClick={() => openDiff(null)}
            className="rounded px-1 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ← Back
          </button>
          <span className="truncate font-mono text-[10px] text-zinc-500">{openDiffPath}</span>
          <span className="ml-auto shrink-0 text-[10px] text-zinc-400">snapshot ↔ working tree</span>
        </div>
        <div className="min-h-0 flex-1">
          <DiffEditor
            height="100%"
            language={LATEX_LANG_ID}
            original={activeEntry.snapshotContent ?? ''}
            modified={activeEntry.currentContent ?? ''}
            beforeMount={(monaco) => registerLatexLanguage(monaco as unknown as typeof Monaco)}
            options={{
              readOnly: true,
              renderSideBySide: false,
              fontSize: 12,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
            }}
          />
        </div>
      </div>
    );
  }

  if (selectedId) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-zinc-200 px-2 py-1 dark:border-zinc-800">
          <button
            onClick={() => void select(null)}
            className="rounded px-1 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ← History
          </button>
          <span className="truncate text-[11px] font-medium">
            {selected ? formatWhen(selected.createdAt) : selectedId}
          </span>
          {selected && (
            <span className="shrink-0 text-[10px] text-zinc-400">
              {reasonLabel(selected.reason)} · {selected.fileCount} files
            </span>
          )}
        </div>

        {diffLoading && <p className="px-2 py-2 text-[11px] text-zinc-400">Comparing…</p>}

        {!diffLoading && diff.length === 0 && (
          <p className="px-2 py-2 text-[11px] text-zinc-400">
            No differences — the workspace matches this snapshot.
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {diff.map((d) => (
            <button
              key={d.path}
              onClick={() => openDiff(d.path)}
              className="flex w-full items-baseline gap-2 px-2 py-0.5 text-left text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <span
                className={`shrink-0 font-mono ${
                  d.status === 'M'
                    ? 'text-amber-600'
                    : d.status === 'A'
                      ? 'text-emerald-600'
                      : 'text-red-600'
                }`}
                title={d.status === 'M' ? 'Modified' : d.status === 'A' ? 'Added on disk' : 'Deleted on disk'}
              >
                {d.status}
              </span>
              <span className="truncate">{d.path}</span>
            </button>
          ))}
        </div>

        <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
          {armedId === selectedId ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-red-600">
                Overwrite working tree with this snapshot?
              </span>
              <button
                onClick={() => {
                  setArmedId(null);
                  void restore(selectedId);
                }}
                disabled={restoringId === selectedId}
                className="ml-auto rounded bg-red-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
              >
                {restoringId === selectedId ? 'Restoring…' : 'Yes, restore'}
              </button>
              <button
                onClick={() => setArmedId(null)}
                className="rounded border border-zinc-300 px-2 py-1 text-[11px] dark:border-zinc-700"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setArmedId(selectedId)}
              disabled={diff.length === 0}
              className="w-full rounded border border-zinc-300 px-2 py-1 text-[11px] hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Restore this snapshot
            </button>
          )}
          <p className="mt-1 text-[10px] text-zinc-400">
            A snapshot of the current state is taken first, so this is reversible.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-zinc-200 p-2 dark:border-zinc-800">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          onClick={async () => {
            await create('manual', label.trim() || undefined);
            setLabel('');
          }}
          disabled={creating}
          className="shrink-0 rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
        >
          {creating ? 'Saving…' : 'Snapshot'}
        </button>
      </div>

      {error && <p className="px-2 py-1 text-[10px] text-red-600">{error}</p>}
      {lastRestore && (
        <p className="px-2 py-1 text-[10px] text-emerald-600">
          Restored {lastRestore.restoredFiles} file(s)
          {lastRestore.removedFiles > 0 ? `, removed ${lastRestore.removedFiles}` : ''}.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && <p className="px-2 py-2 text-[11px] text-zinc-400">Loading history…</p>}
        {!loading && snapshots.length === 0 && (
          <p className="px-2 py-2 text-[11px] text-zinc-400">
            No snapshots yet. Take one before a risky edit.
          </p>
        )}
        {snapshots.map((s) => (
          <div
            key={s.snapshotId}
            className="group flex items-start gap-2 border-b border-zinc-100 px-2 py-1.5 dark:border-zinc-800/60"
          >
            <button
              onClick={() => void select(s.snapshotId)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[11px] font-medium">
                  {s.label || reasonLabel(s.reason)}
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-zinc-400">
                  {formatWhen(s.createdAt)}
                </span>
              </div>
              <div className="text-[10px] text-zinc-500">
                {reasonLabel(s.reason)} · {s.fileCount} files · {formatBytes(s.totalBytes)}
              </div>
            </button>
            <button
              onClick={() => void remove(s.snapshotId)}
              title="Delete snapshot"
              className="shrink-0 rounded px-1 text-[11px] text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-zinc-800"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
