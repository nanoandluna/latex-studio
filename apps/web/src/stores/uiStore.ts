import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type BottomTab = 'problems' | 'output';
type NavigatorView = 'symbols' | 'overview' | 'citations' | 'stats';

/**
 * A read-only snapshot diff opened in the main editor area. Pure view state:
 * closing it never touches the snapshot, the files, or the graph.
 */
export interface DiffSession {
  snapshotId: string;
  /** Tab label, e.g. "Today 17:42" — rendered as `Diff: <label> → Now`. */
  label: string;
  /** File the diff should open on; falls back to the first text change. */
  initialPath?: string;
}

interface UiState {
  explorerVisible: boolean;
  bottomPanelHeight: number;
  bottomPanelVisible: boolean;
  bottomTab: BottomTab;
  /** Which Navigator sub-view is shown; commands set it before the panel mounts. */
  navigatorView: NavigatorView;
  previewVisible: boolean;
  paletteOpen: boolean;
  workspaceModalOpen: boolean;
  envWarningDismissed: boolean;
  /** The snapshot diff currently available in the main area, if any. */
  diffSession: DiffSession | null;
  /** Whether the main area is currently showing the diff (vs. file tabs). */
  diffVisible: boolean;

  toggleExplorer: () => void;
  setBottomPanelHeight: (h: number) => void;
  setBottomTab: (t: BottomTab) => void;
  setNavigatorView: (v: NavigatorView) => void;
  setPaletteOpen: (v: boolean) => void;
  setWorkspaceModalOpen: (v: boolean) => void;
  dismissEnvWarning: () => void;
  togglePreview: () => void;
  toggleBottomPanel: () => void;
  openDiffWorkspace: (session: DiffSession) => void;
  showDiff: () => void;
  hideDiff: () => void;
  closeDiffWorkspace: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      explorerVisible: true,
      bottomPanelHeight: 200,
      bottomPanelVisible: true,
      bottomTab: 'problems',
      navigatorView: 'symbols',
      previewVisible: true,
      paletteOpen: false,
      workspaceModalOpen: false,
      envWarningDismissed: false,
      diffSession: null,
      diffVisible: false,

      toggleExplorer: () => set((s) => ({ explorerVisible: !s.explorerVisible })),
      setBottomPanelHeight: (bottomPanelHeight) => set({ bottomPanelHeight }),
      setBottomTab: (bottomTab) => set({ bottomTab }),
      setNavigatorView: (navigatorView) => set({ navigatorView }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setWorkspaceModalOpen: (workspaceModalOpen) => set({ workspaceModalOpen }),
      dismissEnvWarning: () => set({ envWarningDismissed: true }),
      togglePreview: () => set((s) => ({ previewVisible: !s.previewVisible })),
      toggleBottomPanel: () => set((s) => ({ bottomPanelVisible: !s.bottomPanelVisible })),
      openDiffWorkspace: (diffSession) => set({ diffSession, diffVisible: true }),
      showDiff: () => set((s) => (s.diffSession ? { diffVisible: true } : {})),
      hideDiff: () => set({ diffVisible: false }),
      closeDiffWorkspace: () => set({ diffSession: null, diffVisible: false }),
    }),
    {
      name: 'latex-studio-ui',
      partialize: (s) => ({
        explorerVisible: s.explorerVisible,
        bottomPanelHeight: s.bottomPanelHeight,
        bottomPanelVisible: s.bottomPanelVisible,
        previewVisible: s.previewVisible,
        envWarningDismissed: s.envWarningDismissed,
      }),
    }
  )
);
