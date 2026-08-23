import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../api/client';

export interface EditorTab {
  path: string;
  content: string;
  savedContent: string;
}

interface EditorState {
  tabs: EditorTab[];
  activePath: string | null;
  cursorLine: Record<string, number>;
  revealTarget: { path: string; line: number; token: number } | null;

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
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activePath: null,
      cursorLine: {},
      revealTarget: null,

      openFile: async (path) => {
        const existing = get().tabs.find((t) => t.path === path);
        if (!existing) {
          const res = await api.readFile(path);
          set({
            tabs: [...get().tabs, { path, content: res.content, savedContent: res.content }],
            activePath: path,
          });
        } else {
          set({ activePath: path });
        }
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
        await api.saveFile(path, tab.content);
        set({
          tabs: get().tabs.map((t) =>
            t.path === path ? { ...t, savedContent: t.content } : t
          ),
        });
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
    }),
    {
      name: 'latex-studio-editor',
      partialize: (s) => ({ activePath: s.activePath }),
    }
  )
);
