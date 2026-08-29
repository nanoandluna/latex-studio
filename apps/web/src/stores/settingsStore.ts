import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light' | 'system';
export type CompilerChoice = 'auto' | 'latexmk' | 'xelatex' | 'pdflatex' | 'lualatex';

/**
 * V0.4 auto-save policy. Auto-save uses the ordinary file-write pipeline and
 * deliberately takes no snapshot — snapshots exist so a user can get a version
 * back, not so the app can survive a crash.
 */
export type AutoSavePolicy = 'off' | 'interval' | 'focus-loss';

/** The interval option is fixed at 30s, keeping the knob a simple choice. */
export const AUTO_SAVE_INTERVAL_MS = 30_000;

interface SettingsState {
  compiler: CompilerChoice;
  autoCompile: boolean;
  theme: Theme;
  writingChecks: boolean;
  autoSave: AutoSavePolicy;
  /**
   * Snapshot on focus loss when there are unsaved edits — V0.4-PLAN 1.3's
   * `auto` trigger. Off by default: automatic snapshots are only worth it for
   * people who want the safety net badly enough to sift through the history.
   */
  autoSnapshot: boolean;
  setCompiler: (c: CompilerChoice) => void;
  setAutoCompile: (v: boolean) => void;
  setTheme: (t: Theme) => void;
  setWritingChecks: (v: boolean) => void;
  setAutoSave: (v: AutoSavePolicy) => void;
  setAutoSnapshot: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      compiler: 'xelatex',
      autoCompile: false,
      theme: 'dark',
      writingChecks: true,
      autoSave: 'off',
      autoSnapshot: false,
      setCompiler: (compiler) => set({ compiler }),
      setAutoCompile: (autoCompile) => set({ autoCompile }),
      setTheme: (theme) => set({ theme }),
      setWritingChecks: (writingChecks) => set({ writingChecks }),
      setAutoSave: (autoSave) => set({ autoSave }),
      setAutoSnapshot: (autoSnapshot) => set({ autoSnapshot }),
    }),
    { name: 'latex-studio-settings' }
  )
);
