import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FileNode } from '@latex-studio/shared';
import { api, authedFetch } from '../api/client';
import { useBuildStore } from './buildStore';
import { usePreviewStore } from './previewStore';
import { useEditorStore } from './editorStore';
import { useProjectIndexStore } from './projectIndexStore';
import { useSnapshotStore } from './snapshotStore';
import { useSearchStore } from './searchStore';
import { useStatisticsStore } from './statisticsStore';
import { usePaperOverviewStore } from './paperOverviewStore';
import { useCitationWorkspaceStore } from './citationWorkspaceStore';
import { useUiStore } from './uiStore';

/** Reset every workspace-scoped store so nothing leaks across projects. */
function resetWorkspaceScopedState(): void {
  useBuildStore.getState().reset();
  usePreviewStore.getState().setPdf(null);
  useEditorStore.setState({ tabs: [], activePath: null, revealTarget: null, cursorLine: {} });
  useProjectIndexStore.getState().reset();
  useSnapshotStore.getState().reset();
  useStatisticsStore.getState().reset();
  usePaperOverviewStore.getState().reset();
  useCitationWorkspaceStore.getState().reset();
  useSearchStore.getState().clear();
  useUiStore.getState().closeDiffWorkspace();
}

interface WorkspaceState {
  path: string | null;
  name: string | null;
  mainFile: string | null;
  tree: FileNode | null;
  loading: boolean;
  error: string | null;

  bootstrap: () => Promise<void>;
  openWorkspace: (path: string) => Promise<void>;
  closeWorkspace: () => Promise<void>;
  refreshTree: () => Promise<void>;
  detectMainFile: () => Promise<string | null>;
  setMainFile: (f: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      path: null,
      name: null,
      mainFile: null,
      tree: null,
      loading: false,
      error: null,

      bootstrap: async () => {
        try {
          const state = await api.workspaceState();
          if (state.open) {
            set({ path: state.path, name: state.name, mainFile: state.mainFile });
            await get().refreshTree();
          }
        } catch {
          /* server not ready yet */
        }
      },

      openWorkspace: async (dirPath: string) => {
        set({ loading: true, error: null });
        try {
          const opened = await api.openWorkspace(dirPath);
          // Reset all workspace-scoped state so nothing leaks across projects
          resetWorkspaceScopedState();
          set({ path: opened.path, name: opened.name, mainFile: opened.mainFile });
          await get().refreshTree();
          // seed the status bar's snapshot age for the new workspace
          void useSnapshotStore.getState().refresh().catch(() => {});
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        } finally {
          set({ loading: false });
        }
      },

      closeWorkspace: async () => {
        await api.closeWorkspace();
        resetWorkspaceScopedState();
        set({ path: null, name: null, mainFile: null, tree: null });
      },

      refreshTree: async () => {
        try {
          const tree = await api.tree();
          set({ tree });
        } catch (err) {
          set({ error: (err as Error).message });
        }
      },

      detectMainFile: async () => {
        const res = await authedFetch('/api/workspace/mainfile').then((r) => r.json());
        return res.mainFile ?? null;
      },

      setMainFile: (mainFile) => set({ mainFile }),
    }),
    {
      name: 'latex-studio-workspace',
      partialize: (s) => ({ path: s.path }),
    }
  )
);
