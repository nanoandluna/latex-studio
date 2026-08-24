import { create } from 'zustand';
import type { ProjectIndex, IndexDiagnostic } from '@latex-studio/shared';
import { api } from '../api/client';
import { useEditorStore } from './editorStore';

const BUFFER_DEBOUNCE_MS = 500;
const REFRESH_DEBOUNCE_MS = 800;

interface ProjectIndexState {
  index: ProjectIndex | null;
  loading: boolean;
  lastError: string | null;

  /** Full refresh (scan disk). Called on workspace open / tree refresh. */
  refresh: () => Promise<void>;
  /**
   * Push the live editor buffer for incremental re-parse (debounced).
   * Never blocks typing — the previous index stays queryable.
   */
  pushBuffer: (path: string, content: string) => void;
  reset: () => void;
}

let bufferTimers = new Map<string, number>();
let refreshTimer: number | null = null;

export const useProjectIndexStore = create<ProjectIndexState>()((set, get) => ({
  index: null,
  loading: false,
  lastError: null,

  refresh: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const index = await api.index();
      set({ index, loading: false, lastError: null });
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
        const index = await api.updateIndexBuffer(path, content);
        if (index) set({ index });
      } catch {
        /* transient — next save/refresh will resync */
      }
    }, BUFFER_DEBOUNCE_MS);
    bufferTimers.set(path, t);

    // Also schedule a disk-truth refresh shortly after saves.
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
    set({ index: null, loading: false, lastError: null });
  },
}));

/** Convenience: combined diagnostics from the project index. */
export function selectIndexDiagnostics(): IndexDiagnostic[] {
  return useProjectIndexStore.getState().index?.diagnostics ?? [];
}

// Keep the saved-event → index pipeline wired here so stores stay decoupled.
if (typeof window !== 'undefined') {
  window.addEventListener('latex-studio:saved', ((e: CustomEvent<{ path: string }>) => {
    const tab = useEditorStore
      .getState()
      .tabs.find((t) => t.path === e.detail.path);
    useProjectIndexStore.getState().pushBuffer(e.detail.path, tab?.content ?? '');
  }) as EventListener);
}
