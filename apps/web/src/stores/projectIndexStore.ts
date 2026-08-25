import { create } from 'zustand';
import type { ProjectIndex } from '@latex-studio/shared';
import { api } from '../api/client';
import { useEditorStore } from './editorStore';

const BUFFER_DEBOUNCE_MS = 500;
const REFRESH_DEBOUNCE_MS = 800;

interface ProjectIndexState {
  index: (ProjectIndex & { version?: number; edges?: unknown[] }) | null;
  /** monotonic graph revision of the stored index */
  version: number;
  loading: boolean;
  lastError: string | null;

  refresh: () => Promise<void>;
  pushBuffer: (path: string, content: string) => void;
  reset: () => void;
}

let bufferTimers = new Map<string, number>();
let refreshTimer: number | null = null;

export const useProjectIndexStore = create<ProjectIndexState>()((set, get) => ({
  index: null,
  version: 0,
  loading: false,
  lastError: null,

  refresh: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const body = await api.index() as ProjectIndex & { version?: number };
      // V0.3 stale guard: never let an older revision overwrite a newer one.
      const v = body?.version ?? 0;
      if (v < get().version) {
        set({ loading: false });
        return;
      }
      set({ index: body, version: v, loading: false, lastError: null });
    } catch (err) {
      // Keep the previous index on failure — stale beats empty.
      set({ loading: false, lastError: (err as Error).message });
    }
  },

  pushBuffer: (path, content) => {
    const prev = bufferTimers.get(path);
    if (prev) window.clearTimeout(prev);
    const t = window.setTimeout(async () => {
      bufferTimers.delete(path);
      try {
        const res = await api.updateIndexBuffer(path, content);
        if (res) {
          const body = res as ProjectIndex & { version?: number };
          const v = body.version ?? 0;
          if (v >= get().version) set({ index: body, version: v });
        }
      } catch {
        /* transient — next save/refresh will resync */
      }
    }, BUFFER_DEBOUNCE_MS);
    bufferTimers.set(path, t);

    if (refreshTimer) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      void get().refresh();
    }, REFRESH_DEBOUNCE_MS + BUFFER_DEBOUNCE_MS);
  },

  reset: () => {
    for (const t of bufferTimers.values()) window.clearTimeout(t);
    bufferTimers = new Map();
    if (refreshTimer) window.clearTimeout(refreshTimer);
    refreshTimer = null;
    set({ index: null, version: 0, loading: false, lastError: null });
  },
}));

// Keep the saved-event → index pipeline wired here so stores stay decoupled.
if (typeof window !== 'undefined') {
  window.addEventListener('latex-studio:saved', ((e: CustomEvent<{ path: string }>) => {
    const tab = useEditorStore
      .getState()
      .tabs.find((t) => t.path === e.detail.path);
    useProjectIndexStore.getState().pushBuffer(e.detail.path, tab?.content ?? '');
  }) as EventListener);
}
