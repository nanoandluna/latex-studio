import { create } from 'zustand';
import { api } from '../api/client';

export interface EditorTab { path: string; content: string; savedContent: string | null; }
export type DocumentSaveState = 'clean' | 'dirty' | 'saving' | 'error';
export function documentSaveState(s: {
  saving: number; lastSaveError: string | null; tabs: EditorTab[]; isDirty: (tab: EditorTab) => boolean;
}): DocumentSaveState {
  if (s.saving > 0) return 'saving';
  if (s.lastSaveError) return 'error';
  return s.tabs.some(s.isDirty) ? 'dirty' : 'clean';
}
interface EditorState {
  workspacePath: string | null;
  generation: number;
  tabs: EditorTab[];
  activePath: string | null;
  cursorLine: Record<string, number>;
  revealTarget: { path: string; line: number; token: number } | null;
  saving: number;
  lastSaveError: string | null;
  recoveryNotice: string | null;
  recoveryError: string | null;
  conflictPath: string | null;
  activateWorkspace: (path: string | null) => Promise<void>;
  openFile: (path: string, line?: number) => Promise<void>;
  openFileAtLine: (path: string, line: number) => Promise<void>;
  closeTab: (path: string) => void;
  setActive: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  saveActive: () => Promise<void>;
  saveAll: () => Promise<void>;
  setCursorLine: (path: string, line: number) => void;
  clearReveal: () => void;
  isDirty: (tab: EditorTab) => boolean;
  reloadCleanTabs: () => Promise<void>;
  acceptDisk: (path: string, content: string | null, keepEdits: boolean) => Promise<void>;
}
const sessionKey = (path: string) => `latex-studio-session-v1:${path}`;
const saves = new Map<string, Promise<void>>();
let restoring = false;
let protectStoredDraft = false;

export const useEditorStore = create<EditorState>()((set, get) => ({
  workspacePath: null, generation: 0, tabs: [], activePath: null, cursorLine: {}, revealTarget: null,
  saving: 0, lastSaveError: null, recoveryNotice: null, recoveryError: null, conflictPath: null,
  activateWorkspace: async (workspacePath) => {
    if (get().workspacePath === workspacePath) return;
    const generation = get().generation + 1;
    restoring = true;
    protectStoredDraft = false;
    set({ workspacePath, generation, tabs: [], activePath: null, cursorLine: {}, revealTarget: null,
      saving: 0, lastSaveError: null, recoveryNotice: null, recoveryError: null, conflictPath: null });
    if (!workspacePath) { restoring = false; return; }
    try {
      const raw = localStorage.getItem(sessionKey(workspacePath));
      const session = raw ? JSON.parse(raw) : null;
      if (!session) return;
      if (session.version !== 1 || !Array.isArray(session.tabs)) throw new Error('Unsupported or corrupt session');
      const restored: EditorTab[] = [];
      const seen = new Set<string>();
      let recovered = 0;
      for (const cached of session.tabs) {
        if (typeof cached.path !== 'string' || seen.has(cached.path)) continue;
        seen.add(cached.path);
        let disk: string | null;
        try { disk = (await api.readFile(cached.path)).content; }
        catch (err) {
          if ((err as Error & { code?: string }).code === 'FILE_NOT_FOUND') disk = null;
          else throw err;
        }
        if (get().generation !== generation) return;
        const dirty = typeof cached.content === 'string' &&
          (typeof cached.savedContent === 'string' || cached.savedContent === null);
        if (dirty && cached.content !== disk) {
          restored.push({ path: cached.path, content: cached.content, savedContent: cached.savedContent });
          recovered++;
        } else if (disk !== null) restored.push({ path: cached.path, content: disk, savedContent: disk });
      }
      if (get().generation !== generation) return;
      const current = get().tabs;
      const tabs = [...restored.filter((t) => !current.some((c) => c.path === t.path)), ...current];
      set({ tabs, activePath: get().activePath ?? (tabs.some((t) => t.path === session.activePath)
        ? session.activePath : tabs[0]?.path ?? null),
        recoveryNotice: recovered ? `Recovered ${recovered} unsaved file${recovered === 1 ? '' : 's'}. Review and save when ready.` : null });
    } catch {
      if (get().generation === generation) {
        protectStoredDraft = true;
        set({ recoveryError: 'Session recovery could not finish. The stored draft has been kept.' });
      }
    } finally {
      if (get().generation === generation) {
        restoring = false;
        set({ tabs: [...get().tabs] });
      }
    }
  },
  openFile: async (path) => {
    if (get().tabs.some((t) => t.path === path)) { set({ activePath: path }); return; }
    const generation = get().generation;
    const res = await api.readFile(path);
    if (get().generation !== generation) return;
    if (!get().tabs.some((t) => t.path === path))
      set({ tabs: [...get().tabs, { path, content: res.content, savedContent: res.content }] });
    set({ activePath: path });
  },
  openFileAtLine: async (path, line) => {
    const generation = get().generation;
    await get().openFile(path);
    if (get().generation === generation) set({ revealTarget: { path, line, token: Date.now() } });
  },
  closeTab: (path) => {
    const index = get().tabs.findIndex((t) => t.path === path);
    const tabs = get().tabs.filter((t) => t.path !== path);
    set({ tabs, activePath: get().activePath === path ? tabs[Math.min(index, tabs.length - 1)]?.path ?? null : get().activePath });
  },
  setActive: (activePath) => set({ activePath }),
  updateContent: (path, content) => set({ tabs: get().tabs.map((t) => t.path === path ? { ...t, content } : t) }),
  saveFile: async (path) => {
    const generation = get().generation;
    const workspacePath = get().workspacePath;
    if (!workspacePath) return;
    const key = `${generation}:${path}`;
    const previous = saves.get(key) ?? Promise.resolve();
    const save = previous.catch(() => {}).then(async () => {
      if (get().generation !== generation) return;
      const tab = get().tabs.find((t) => t.path === path);
      if (!tab || !get().isDirty(tab)) return;
      const sentContent = tab.content;
      set((s) => ({ saving: s.saving + 1, lastSaveError: null }));
      try {
        await api.saveFile(path, sentContent, tab.savedContent, workspacePath);
        if (get().generation !== generation) return;
        set((s) => ({ tabs: s.tabs.map((t) => t.path === path ? { ...t, savedContent: sentContent } : t) }));
        window.dispatchEvent(new CustomEvent('latex-studio:saved', { detail: { path } }));
      } catch (err) {
        if (get().generation === generation) set({ lastSaveError: (err as Error).message || 'Save failed',
          conflictPath: (err as Error & { code?: string }).code === 'CONFLICT' ? path : null });
        throw err;
      } finally { if (get().generation === generation) set((s) => ({ saving: s.saving - 1 })); }
    });
    saves.set(key, save);
    try { await save; } finally { if (saves.get(key) === save) saves.delete(key); }
  },
  saveActive: async () => { const path = get().activePath; if (path) await get().saveFile(path); },
  saveAll: async () => {
    const generation = get().generation;
    for (const tab of get().tabs) {
      if (get().generation !== generation) return;
      if (get().isDirty(tab)) await get().saveFile(tab.path);
    }
  },
  setCursorLine: (path, line) => set({ cursorLine: { ...get().cursorLine, [path]: line } }),
  clearReveal: () => set({ revealTarget: null }),
  isDirty: (tab) => tab.content !== tab.savedContent,
  reloadCleanTabs: async () => {
    const generation = get().generation;
    for (const tab of get().tabs.filter((t) => !get().isDirty(t))) {
      try {
        const res = await api.readFile(tab.path);
        if (get().generation !== generation) return;
        set((s) => ({ tabs: s.tabs.map((t) => t.path === tab.path && !s.isDirty(t)
          ? { ...t, content: res.content, savedContent: res.content } : t) }));
      } catch { /* deleted files keep their last readable buffer */ }
    }
  },
  acceptDisk: async (path, content, keepEdits) => {
    set((s) => ({ tabs: s.tabs.map((t) => t.path === path ? { ...t,
      content: keepEdits ? t.content : content ?? '', savedContent: content } : t),
      conflictPath: null, lastSaveError: null }));
    if (keepEdits) await get().saveFile(path);
    else if (content === null) get().closeTab(path);
  },
}));

// Synchronous draft storage survives reload without depending on a pending timer.
useEditorStore.subscribe((state, previous) => {
  if (restoring || protectStoredDraft || !state.workspacePath ||
      (state.tabs === previous.tabs && state.activePath === previous.activePath)) return;
  try {
    localStorage.setItem(sessionKey(state.workspacePath), JSON.stringify({ version: 1,
      activePath: state.activePath, tabs: state.tabs.map((t) => state.isDirty(t) ? t : { path: t.path }) }));
    if (state.recoveryError) useEditorStore.setState({ recoveryError: null });
  } catch {
    useEditorStore.setState({ recoveryError: 'Browser draft storage is unavailable or full. Save your work to disk before closing.' });
  }
});
