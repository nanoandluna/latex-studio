import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../api/client';

export interface EditorTab {
  path: string;
  content: string;
  savedContent: string;
}

/**
 * The save state of the workspace as shown in the status bar. Derived — never
 * string-matched from buttons or titles.
 */
export type DocumentSaveState = 'clean' | 'dirty' | 'saving' | 'error';

export function documentSaveState(s: {
  saving: number;
  lastSaveError: string | null;
  tabs: EditorTab[];
  isDirty: (tab: EditorTab) => boolean;
}): DocumentSaveState {
  if (s.saving > 0) return 'saving';
  if (s.lastSaveError) return 'error';
  return s.tabs.some((t) => s.isDirty(t)) ? 'dirty' : 'clean';
}

interface EditorState {
  tabs: EditorTab[];
  activePath: string | null;
  cursorLine: Record<string, number>;
  revealTarget: { path: string; line: number; token: number } | null;
  /** In-flight save count across all tabs. */
  saving: number;
  /** Last save error message; cleared by the next attempted save. */
  lastSaveError: string | null;

  openFile: (path: string, line?: number) => Promise<void>;
  openFileAtLine: (path: string, line: number) => Promise<void>;
  closeTab: (path: string) => void;
  setActive: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  saveActive: () => Promise<void>;
  setCursorLine: (path: string, line: number) => void;
  clearReveal: () => void;
  isDirty: (tab: EditorTab) => boolean;
  reloadCleanTabs: () => Promise<void>;
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activePath: null,
      cursorLine: {},
      revealTarget: null,
      saving: 0,
      lastSaveError: null,

      openFile: async (path) => {
        const existing = get().tabs.find((t) => t.path === path);
        if (existing) {
          set({ activePath: path });
          return;
        }
        const res = await api.readFile(path);
        // a concurrent open of the same path (e.g. a double-click firing two
        // clicks) may have landed while we were reading — never add a twin
        if (get().tabs.some((t) => t.path === path)) {
          set({ activePath: path });
          return;
        }
        set({
          tabs: [...get().tabs, { path, content: res.content, savedContent: res.content }],
          activePath: path,
        });
      },

      openFileAtLine: async (path, line) => {
        await get().openFile(path);
        set({ revealTarget: { path, line, token: Date.now() } });
      },

      closeTab: (path) => {
        const tabs = get().tabs.filter((t) => t.path !== path);
        let activePath = get().activePath;
        if (activePath === path) {
          const idx = get().tabs.findIndex((t) => t.path === path);
          activePath = tabs[Math.min(idx, tabs.length - 1)]?.path ?? null;
        }
        set({ tabs, activePath });
      },

      setActive: (activePath) => set({ activePath }),

      updateContent: (path, content) =>
        set({
          tabs: get().tabs.map((t) => (t.path === path ? { ...t, content } : t)),
        }),

      saveFile: async (path) => {
        const tab = get().tabs.find((t) => t.path === path);
        if (!tab) return;
        set((s) => ({ saving: s.saving + 1, lastSaveError: null }));
        try {
          await api.saveFile(path, tab.content);
        } catch (err) {
          set((s) => ({ saving: s.saving - 1, lastSaveError: (err as Error).message || 'Save failed' }));
          throw err;
        }
        set((s) => ({
          saving: s.saving - 1,
          tabs: s.tabs.map((t) =>
            t.path === path ? { ...t, savedContent: t.content } : t
          ),
        }));
        window.dispatchEvent(new CustomEvent('latex-studio:saved', { detail: { path } }));
      },

      saveActive: async () => {
        const p = get().activePath;
        if (p) await get().saveFile(p);
      },

      setCursorLine: (path, line) =>
        set({ cursorLine: { ...get().cursorLine, [path]: line } }),

      clearReveal: () => set({ revealTarget: null }),

      isDirty: (tab) => tab.content !== tab.savedContent,

      /**
       * Re-sync clean tabs after disk truth changed underneath them (snapshot
       * restore, replace-all). The reloaded state counts as saved — the buffer
       * simply reflects the new disk bytes. Dirty tabs keep the user's unsaved
       * buffer: the buffer wins until an explicit save. Files a restore removed
       * keep their last buffer, so nothing on screen disappears.
       */
      reloadCleanTabs: async () => {
        const clean = get().tabs.filter((t) => !get().isDirty(t));
        if (clean.length === 0) return;
        const results = await Promise.all(
          clean.map(async (t) => {
            try {
              const res = await api.readFile(t.path);
              return { path: t.path, content: res.content };
            } catch {
              return null;
            }
          })
        );
        const fresh = new Map<string, string>();
        for (const r of results) if (r) fresh.set(r.path, r.content);
        if (fresh.size === 0) return;
        set({
          tabs: get().tabs.map((t) =>
            fresh.has(t.path) ? { ...t, content: fresh.get(t.path)!, savedContent: fresh.get(t.path)! } : t
          ),
        });
      },
    }),
    {
      name: 'latex-studio-editor',
      partialize: (s) => ({ activePath: s.activePath }),
    }
  )
);
