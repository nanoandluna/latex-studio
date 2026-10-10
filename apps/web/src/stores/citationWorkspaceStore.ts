import { create } from 'zustand';
import { api } from '../api/client';
import type { CitationWorkspaceResponse } from '@latex-studio/shared';

interface CitationWorkspaceState {
  data: CitationWorkspaceResponse | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  reset: () => void;
}

let generation = 0;
export const useCitationWorkspaceStore = create<CitationWorkspaceState>()((set) => ({
  data: null,
  loading: false,
  error: null,

  load: async () => {
    const epoch = generation;
    set({ loading: true, error: null });
    try {
      const data = await api.citationWorkspace();
      if (epoch !== generation) return;
      set({ data, loading: false });
    } catch (err) {
      if (epoch !== generation) return;
      set({ loading: false, error: (err as Error).message || 'Could not load citations' });
    }
  },

  /** Workspace switched — the previous project's bibliography must not show. */
  reset: () => { generation++; set({ data: null, loading: false, error: null }); },
}));
