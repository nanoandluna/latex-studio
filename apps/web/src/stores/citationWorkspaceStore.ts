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

export const useCitationWorkspaceStore = create<CitationWorkspaceState>()((set) => ({
  data: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.citationWorkspace();
      set({ data, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message || 'Could not load citations' });
    }
  },

  /** Workspace switched — the previous project's bibliography must not show. */
  reset: () => set({ data: null, loading: false, error: null }),
}));
