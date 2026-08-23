import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type BottomTab = 'problems' | 'output';

interface UiState {
  explorerVisible: boolean;
  bottomPanelHeight: number;
  bottomTab: BottomTab;
  paletteOpen: boolean;
  workspaceModalOpen: boolean;
  envWarningDismissed: boolean;

  toggleExplorer: () => void;
  setBottomPanelHeight: (h: number) => void;
  setBottomTab: (t: BottomTab) => void;
  setPaletteOpen: (v: boolean) => void;
  setWorkspaceModalOpen: (v: boolean) => void;
  dismissEnvWarning: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      explorerVisible: true,
      bottomPanelHeight: 200,
      bottomTab: 'problems',
      paletteOpen: false,
      workspaceModalOpen: false,
      envWarningDismissed: false,

      toggleExplorer: () => set((s) => ({ explorerVisible: !s.explorerVisible })),
      setBottomPanelHeight: (bottomPanelHeight) => set({ bottomPanelHeight }),
      setBottomTab: (bottomTab) => set({ bottomTab }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setWorkspaceModalOpen: (workspaceModalOpen) => set({ workspaceModalOpen }),
      dismissEnvWarning: () => set({ envWarningDismissed: true }),
    }),
    {
      name: 'latex-studio-ui',
      partialize: (s) => ({
        explorerVisible: s.explorerVisible,
        bottomPanelHeight: s.bottomPanelHeight,
        envWarningDismissed: s.envWarningDismissed,
      }),
    }
  )
);
