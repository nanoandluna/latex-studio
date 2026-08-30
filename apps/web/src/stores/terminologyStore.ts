import { create } from 'zustand';
import { api } from '../api/client';
import type { TerminologyHit, TerminologyTerm } from '@latex-studio/shared';

interface TerminologyState {
  terms: TerminologyTerm[];
  hits: TerminologyHit[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  load: () => Promise<void>;
  save: (terms: TerminologyTerm[]) => Promise<void>;
  rescan: () => Promise<void>;
  reset: () => void;
}

export const useTerminologyStore = create<TerminologyState>()((set, get) => ({
  terms: [],
  hits: [],
  loading: false,
  saving: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const [{ terms }, { hits }] = await Promise.all([api.terminology(), api.terminologyHits()]);
      set({ terms, hits, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message || 'Could not load terminology' });
    }
  },

  save: async (terms) => {
    set({ saving: true, error: null });
    try {
      const saved = await api.saveTerminology(terms);
      set({ terms: saved.terms, saving: false });
      await get().rescan();
    } catch (err) {
      set({ saving: false, error: (err as Error).message || 'Could not save terminology' });
    }
  },

  rescan: async () => {
    try {
      const { hits } = await api.terminologyHits();
      set({ hits });
    } catch {
      /* keep the previous hits */
    }
  },

  reset: () => set({ terms: [], hits: [], loading: false, saving: false, error: null }),
}));
