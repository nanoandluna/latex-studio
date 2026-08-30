import { create } from 'zustand';
import { api } from '../api/client';
import type { PaperOverview } from '@latex-studio/shared';

interface PaperOverviewState {
  data: PaperOverview | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  reset: () => void;
}

export const usePaperOverviewStore = create<PaperOverviewState>()((set) => ({
  data: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.paperOverview();
      set({ data, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message || 'Could not load the overview' });
    }
  },

  /** Workspace switched — the previous paper must not show through. */
  reset: () => set({ data: null, loading: false, error: null }),
}));
