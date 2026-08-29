import { create } from 'zustand';
import { api } from '../api/client';
import { useEditorStore } from './editorStore';
import type { SearchMatch, SearchOptions } from '@latex-studio/shared';

interface SearchState {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  includeGlob: string;
  excludeGlob: string;

  results: SearchMatch[];
  searching: boolean;
  searchedFiles: number;
  durationMs: number;
  truncated: boolean;
  error: string | null;

  // Replace flow: a preview must exist before an apply is possible.
  replacement: string;
  previewToken: string | null;
  previewFiles: { file: string; replacements: number }[];
  previewTotal: number;
  previewing: boolean;
  applying: boolean;
  lastApply: { filesModified: number; totalReplacements: number; snapshotId: string } | null;

  setQuery: (q: string) => void;
  toggle: (key: 'caseSensitive' | 'wholeWord' | 'regex') => void;
  setIncludeGlob: (v: string) => void;
  setExcludeGlob: (v: string) => void;
  setReplacement: (v: string) => void;

  run: () => Promise<void>;
  previewReplace: () => Promise<void>;
  applyReplace: () => Promise<boolean>;
  clear: () => void;
}

function currentOptions(s: SearchState): SearchOptions {
  return {
    query: s.query,
    caseSensitive: s.caseSensitive,
    wholeWord: s.wholeWord,
    regex: s.regex,
    ...(s.includeGlob.trim() ? { includeGlob: s.includeGlob.trim() } : {}),
    ...(s.excludeGlob.trim() ? { excludeGlob: s.excludeGlob.trim() } : {}),
  };
}

export const useSearchStore = create<SearchState>()((set, get) => ({
  query: '',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  includeGlob: '',
  excludeGlob: '',

  results: [],
  searching: false,
  searchedFiles: 0,
  durationMs: 0,
  truncated: false,
  error: null,

  replacement: '',
  previewToken: null,
  previewFiles: [],
  previewTotal: 0,
  previewing: false,
  applying: false,
  lastApply: null,

  setQuery: (query) => set({ query }),
  toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<SearchState>),
  setIncludeGlob: (includeGlob) => set({ includeGlob }),
  setExcludeGlob: (excludeGlob) => set({ excludeGlob }),

  // Changing the replacement text invalidates the token, because the token is
  // bound to the exact parameters it was issued for.
  setReplacement: (replacement) =>
    set({ replacement, previewToken: null, previewFiles: [], previewTotal: 0 }),

  run: async () => {
    const s = get();
    if (!s.query) {
      set({ results: [], error: null });
      return;
    }
    set({ searching: true, error: null });
    try {
      const res = await api.search(currentOptions(s));
      set({
        results: res.matches,
        searchedFiles: res.searchedFiles,
        durationMs: res.durationMs,
        truncated: res.truncated,
        searching: false,
      });
    } catch (err) {
      set({
        results: [],
        searching: false,
        error: (err as Error).message || 'Search failed',
      });
    }
  },

  previewReplace: async () => {
    const s = get();
    if (!s.query) return;
    set({ previewing: true, error: null });
    try {
      const res = await api.previewReplace({
        ...currentOptions(s),
        replacement: s.replacement,
      });
      set({
        previewToken: res.confirmToken,
        previewFiles: res.files,
        previewTotal: res.totalReplacements,
        previewing: false,
      });
    } catch (err) {
      set({ previewToken: null, previewing: false, error: (err as Error).message });
    }
  },

  applyReplace: async () => {
    const s = get();
    if (!s.previewToken) return false;
    set({ applying: true, error: null });
    try {
      const res = await api.applyReplace({
        ...currentOptions(s),
        replacement: s.replacement,
        confirmToken: s.previewToken,
      });
      set({
        applying: false,
        // token is single-use on the server; drop it so a retry re-previews
        previewToken: null,
        previewFiles: [],
        previewTotal: 0,
        lastApply: {
          filesModified: res.filesModified,
          totalReplacements: res.totalReplacements,
          snapshotId: res.snapshotId,
        },
      });
      // disk truth changed — bring clean editor buffers back in sync
      await useEditorStore.getState().reloadCleanTabs();
      return true;
    } catch (err) {
      set({ applying: false, previewToken: null, error: (err as Error).message });
      return false;
    }
  },

  clear: () =>
    set({
      results: [],
      error: null,
      previewToken: null,
      previewFiles: [],
      previewTotal: 0,
      lastApply: null,
    }),
}));

/** Group matches by file, preserving first-hit order. */
export function groupMatches(matches: SearchMatch[]): { file: string; hits: SearchMatch[] }[] {
  const out: { file: string; hits: SearchMatch[] }[] = [];
  const index = new Map<string, { file: string; hits: SearchMatch[] }>();
  for (const m of matches) {
    let g = index.get(m.file);
    if (!g) {
      g = { file: m.file, hits: [] };
      index.set(m.file, g);
      out.push(g);
    }
    g.hits.push(m);
  }
  return out;
}
