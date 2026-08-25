import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light' | 'system';
export type CompilerChoice = 'auto' | 'latexmk' | 'xelatex' | 'pdflatex' | 'lualatex';

interface SettingsState {
  compiler: CompilerChoice;
  autoCompile: boolean;
  theme: Theme;
  writingChecks: boolean;
  setCompiler: (c: CompilerChoice) => void;
  setAutoCompile: (v: boolean) => void;
  setTheme: (t: Theme) => void;
  setWritingChecks: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      compiler: 'xelatex',
      autoCompile: false,
      theme: 'dark',
      writingChecks: true,
      setCompiler: (compiler) => set({ compiler }),
      setAutoCompile: (autoCompile) => set({ autoCompile }),
      setTheme: (theme) => set({ theme }),
      setWritingChecks: (writingChecks) => set({ writingChecks }),
    }),
    { name: 'latex-studio-settings' }
  )
);
