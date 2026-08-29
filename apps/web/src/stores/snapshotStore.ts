import { create } from 'zustand';
import { api } from '../api/client';
import type { SnapshotDiffEntry, SnapshotManifest, SnapshotReason } from '@latex-studio/shared';

interface SnapshotState {
  snapshots: SnapshotManifest[];
  loading: boolean;
  error: string | null;

  /** Snapshot currently opened in the diff viewer. */
  selectedId: string | null;
  diff: SnapshotDiffEntry[];
  diffLoading: boolean;
  /** Path inside `diff` shown in the editor, or null for the change list. */
  openDiffPath: string | null;

  creating: boolean;
  restoringId: string | null;
  lastRestore: { restoredFiles: number; removedFiles: number } | null;

  refresh: () => Promise<void>;
  create: (reason?: SnapshotReason, label?: string) => Promise<SnapshotManifest | null>;
  select: (id: string | null) => Promise<void>;
  openDiff: (path: string | null) => void;
  restore: (id: string, files?: string[]) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
}

export const useSnapshotStore = create<SnapshotState>()((set, get) => ({
  snapshots: [],
  loading: false,
  error: null,

  selectedId: null,
  diff: [],
  diffLoading: false,
  openDiffPath: null,

  creating: false,
  restoringId: null,
  lastRestore: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const snapshots = await api.listSnapshots();
      set({ snapshots, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message || 'Could not load history' });
    }
  },

  create: async (reason = 'manual', label) => {
    set({ creating: true, error: null });
    try {
      const manifest = await api.createSnapshot(reason, label);
      set({ creating: false });
      await get().refresh();
      return manifest;
    } catch (err) {
      set({ creating: false, error: (err as Error).message || 'Snapshot failed' });
      return null;
    }
  },

  select: async (id) => {
    set({ selectedId: id, openDiffPath: null, diff: [] });
    if (!id) return;
    set({ diffLoading: true });
    try {
      const res = await api.snapshotDiff(id);
      // ignore a stale response if the user moved on while it was in flight
      if (get().selectedId !== id) return;
      set({ diff: res.entries, diffLoading: false });
    } catch (err) {
      if (get().selectedId !== id) return;
      set({ diffLoading: false, error: (err as Error).message });
    }
  },

  openDiff: (path) => set({ openDiffPath: path }),

  restore: async (id, files) => {
    set({ restoringId: id, error: null });
    try {
      const res = await api.restoreSnapshot(id, files);
      set({
        restoringId: null,
        lastRestore: { restoredFiles: res.restoredFiles, removedFiles: res.removedFiles },
      });
      await get().refresh();
      await get().select(null);
      return res.failed.length === 0;
    } catch (err) {
      set({ restoringId: null, error: (err as Error).message || 'Restore failed' });
      return false;
    }
  },

  remove: async (id) => {
    try {
      await api.deleteSnapshot(id);
      if (get().selectedId === id) set({ selectedId: null, diff: [], openDiffPath: null });
      await get().refresh();
    } catch (err) {
      set({ error: (err as Error).message || 'Delete failed' });
    }
  },
}));

const REASON_LABELS: Record<string, string> = {
  manual: 'Manual',
  auto: 'Auto',
  'build-ok': 'Build succeeded',
  'pre-replace': 'Before replace',
  'pre-restore': 'Before restore',
  'before-import': 'Before import',
};

export function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

export function formatWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Today ${time}` : `${d.toLocaleDateString()} ${time}`;
}
