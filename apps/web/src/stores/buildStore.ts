import { create } from 'zustand';
import type { BuildRecord, Problem } from '@latex-studio/shared';
import { api, authedFetch } from '../api/client';
import { useWorkspaceStore } from './workspaceStore';
import { useSettingsStore } from './settingsStore';
import { usePreviewStore } from './previewStore';

export type BuildStatus =
  | 'idle'
  | 'queued'
  | 'starting'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'compiler_unavailable';

const TERMINAL: BuildStatus[] = ['success', 'failed', 'cancelled', 'timeout', 'compiler_unavailable'];

interface BuildState {
  status: BuildStatus;
  buildId: string | null;
  durationMs: number;
  /** Wall-clock ms timestamp of when the current/last build started. */
  startedAt: number | null;
  problems: Problem[];
  log: string;
  error: string | null;
  notice: string | null;
  /** set when a save happens while a build is running; triggers one rebuild */
  dirtySinceBuild: boolean;

  build: () => Promise<void>;
  refreshLatest: () => Promise<void>;
  cancel: () => Promise<void>;
  clearLog: () => void;
  setLog: (log: string) => void;
  reset: () => void;
}

function toUiStatus(s: BuildRecord['status']): BuildStatus {
  return s as BuildStatus;
}

export const useBuildStore = create<BuildState>()((set, get) => ({
  status: 'idle',
  buildId: null,
  durationMs: 0,
  startedAt: null,
  problems: [],
  log: '',
  error: null,
  notice: null,
  dirtySinceBuild: false,

  build: async () => {
    const { path, mainFile } = useWorkspaceStore.getState();
    const compiler = useSettingsStore.getState().compiler;
    if (!path) return;
    if (!mainFile) {
      set({ error: 'No main .tex file detected. Set one in Settings.' });
      return;
    }
    if (get().status === 'running' || get().status === 'starting' || get().status === 'queued') {
      set({ dirtySinceBuild: true });
      return;
    }
    set({ status: 'starting', startedAt: Date.now(), error: null });
    try {
      const rec: BuildRecord = await api.build(mainFile, compiler);
      applyRecord(set, rec);
      // refresh log asynchronously
      api.buildLog(rec.buildId).then((r) => set({ log: r.log })).catch(() => {});
    } catch (err) {
      const e = err as Error & { code?: string };
      set({
        status: e.code === 'COMPILER_NOT_FOUND' ? 'compiler_unavailable' : 'failed',
        error: e.message,
      });
    }

    // Auto-build catch-up: if the user saved during the build, rebuild once
    // so the PDF always reflects the latest sources.
    if (get().dirtySinceBuild && !TERMINAL.includes(get().status)) return;
    if (get().dirtySinceBuild) {
      set({ dirtySinceBuild: false });
      void get().build();
    }
  },

  refreshLatest: async () => {
    try {
      const res = await authedFetch('/api/build/latest').then((r) => r.json());
      // Never surface a build that belongs to another workspace (e.g. a
      // record left over from before a workspace switch).
      const wsPath = useWorkspaceStore.getState().path;
      if (res && res.buildId && res.workspacePath && res.workspacePath !== wsPath) return;
      if (res && res.buildId) {
        applyRecord(set, res as BuildRecord);
      }
    } catch {
      /* ignore */
    }
  },

  cancel: async () => {
    const id = get().buildId;
    if (id) await api.cancelBuild(id).catch(() => {});
  },

  clearLog: () => set({ log: '' }),
  setLog: (log) => set({ log }),

  reset: () =>
    set({
      status: 'idle',
      buildId: null,
      durationMs: 0,
      startedAt: null,
      problems: [],
      log: '',
      error: null,
      notice: null,
      dirtySinceBuild: false,
    }),
}));

function applyRecord(
  set: (partial: Partial<BuildState>) => void,
  rec: BuildRecord
): void {
  set({
    status: toUiStatus(rec.status),
    buildId: rec.buildId,
    durationMs: rec.durationMs,
    problems: rec.problems ?? [],
    error:
      rec.status === 'compiler_unavailable'
        ? rec.errorMessage ?? 'No LaTeX compiler found'
        : rec.status === 'failed' || rec.status === 'timeout'
          ? rec.errorMessage ?? null
          : null,
    notice: rec.notice ?? null,
  });
  if (rec.pdfAvailable) {
    usePreviewStore.getState().setPdf(`/api/build/${rec.buildId}/pdf?v=${Date.now()}`);
  }
}
