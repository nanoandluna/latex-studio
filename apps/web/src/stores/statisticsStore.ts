import { create } from 'zustand';
import { api } from '../api/client';
import type { StatisticsResponse } from '@latex-studio/shared';

interface StatisticsState {
  data: StatisticsResponse | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  reset: () => void;
}

export const useStatisticsStore = create<StatisticsState>()((set) => ({
  data: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.statistics();
      set({ data, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message || 'Could not load statistics' });
    }
  },

  /** Workspace switched — stale numbers from the previous project must not show. */
  reset: () => set({ data: null, loading: false, error: null }),
}));
