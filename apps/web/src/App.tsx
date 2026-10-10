import { lazy, Suspense, useEffect, useState } from 'react';
import { Header } from './components/layout/Header';
import { Splitter } from './components/layout/Splitter';
import { Sidebar } from './components/explorer/Sidebar';
import { Welcome } from './components/dialogs/Welcome';
import { useEditorStore } from './stores/editorStore';
import { ProblemsPanel } from './components/problems/ProblemsPanel';
import { CommandPalette } from './components/palette/CommandPalette';
import { WorkspaceModal } from './components/dialogs/WorkspaceModal';
import { useHotkeys } from './hooks/useHotkeys';
import { useAutoBuild } from './hooks/useAutoBuild';
import { useAutoSave } from './hooks/useAutoSave';
import { useWorkspaceStore } from './stores/workspaceStore';
import { useUiStore } from './stores/uiStore';
import { useSettingsStore } from './stores/settingsStore';
import { useBuildStore } from './stores/buildStore';
import { useProjectIndexStore } from './stores/projectIndexStore';
import { useSnapshotStore } from './stores/snapshotStore';
import { api } from './api/client';

const EditorPane = lazy(() => import('./components/editor/EditorPane').then((m) => ({ default: m.EditorPane })));
const PdfPreview = lazy(() => import('./components/preview/PdfPreview').then((m) => ({ default: m.PdfPreview })));

export default function App() {
  const workspacePath = useWorkspaceStore((s) => s.path);
  const tree = useWorkspaceStore((s) => s.tree);
  const bootstrap = useWorkspaceStore((s) => s.bootstrap);
  const refreshLatest = useBuildStore((s) => s.refreshLatest);
  const explorerVisible = useUiStore((s) => s.explorerVisible);
  const bottomPanelHeight = useUiStore((s) => s.bottomPanelHeight);
  const bottomPanelVisible = useUiStore((s) => s.bottomPanelVisible);
  const previewVisible = useUiStore((s) => s.previewVisible);
  const setBottomPanelHeight = useUiStore((s) => s.setBottomPanelHeight);
  const theme = useSettingsStore((s) => s.theme);
  const buildStatus = useBuildStore((s) => s.status);
  const building =
    buildStatus === 'running' || buildStatus === 'starting' || buildStatus === 'queued';

  const [explorerWidth, setExplorerWidth] = useState(240);
  const [previewWidth, setPreviewWidth] = useState(480);

  useHotkeys();
  useAutoBuild();
  useAutoSave();
  useEffect(() => {
    if (!workspacePath) return;
    let alive = true;
    let checking = false;
    const check = async () => {
      if (!alive || checking || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const revision = await api.indexRevision();
        if (alive && revision.root === workspacePath && revision.version !== useProjectIndexStore.getState().version) {
          await useProjectIndexStore.getState().refresh();
          if (!alive) return;
          await useWorkspaceStore.getState().refreshTree();
          if (alive) await useEditorStore.getState().reloadCleanTabs();
        }
      } catch { /* the next probe retries after a server restart */ }
      finally { checking = false; }
    };
    const timer = window.setInterval(() => void check(), 2000);
    window.addEventListener('focus', check);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', check); };
  }, [workspacePath]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const state = useEditorStore.getState();
      if (state.tabs.some(state.isDirty) || state.saving > 0) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  // Theme class on <html>
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    if (theme === 'system') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme]);

  // Restore session: server remembers the last workspace
  useEffect(() => {
    void bootstrap().then(() => {
      refreshLatest();
      // seed the status bar's snapshot age for the restored workspace
      void useSnapshotStore.getState().refresh().catch(() => {});
    });
  }, [bootstrap, refreshLatest]);

  // Refresh the project index whenever the file tree changes (open/save/etc).
  useEffect(() => {
    if (tree && workspacePath) void useProjectIndexStore.getState().refresh();
  }, [tree, workspacePath]);

  return (
    <div className="flex h-full flex-col">
      <Header />
      {workspacePath && building && <div className="build-progress shrink-0" aria-hidden />}

      {!workspacePath ? (
        <Welcome />
      ) : (
        <>
          <div className="flex min-h-0 flex-1">
            {explorerVisible && (
              <>
                <aside className="shrink-0 overflow-hidden border-r border-zinc-200 dark:border-zinc-800" style={{ width: explorerWidth }}>
                  <Sidebar />
                </aside>
                <Splitter orientation="vertical" onResize={(d) => setExplorerWidth((w) => Math.min(500, Math.max(160, w + d)))} />
              </>
            )}

            <main className="min-w-0 flex-1">
              <Suspense fallback={<div className="p-4 text-sm text-zinc-500">Loading editor…</div>}><EditorPane key={workspacePath} /></Suspense>
            </main>

            {previewVisible && (
              <>
                <Splitter orientation="vertical" onResize={(d) => setPreviewWidth((w) => Math.min(window.innerWidth - 400, Math.max(280, w - d)))} />
                <aside className="shrink-0 overflow-hidden" style={{ width: previewWidth }}>
                  <Suspense fallback={<div className="p-4 text-sm text-zinc-500">Loading preview…</div>}><PdfPreview /></Suspense>
                </aside>
              </>
            )}
          </div>

          {bottomPanelVisible && (
            <>
              <Splitter
                orientation="horizontal"
                onResize={(d) => {
                  const cur = useUiStore.getState().bottomPanelHeight;
                  setBottomPanelHeight(Math.min(Math.max(cur - d, 80), Math.floor(window.innerHeight * 0.6)));
                }}
              />
              <div className="shrink-0 overflow-hidden border-t border-zinc-200 dark:border-zinc-800" style={{ height: bottomPanelHeight }}>
                <ProblemsPanel />
              </div>
            </>
          )}
        </>
      )}

      <CommandPalette />
      <WorkspaceModal />
    </div>
  );
}
