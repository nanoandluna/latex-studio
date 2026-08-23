import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light' | 'system';
export type CompilerChoice = 'auto' | 'latexmk' | 'xelatex' | 'pdflatex' | 'lualatex';

interface SettingsState {
  compiler: CompilerChoice;
  autoCompile: boolean;
  theme: Theme;
  setCompiler: (c: CompilerChoice) => void;
  setAutoCompile: (v: boolean) => void;
  setTheme: (t: Theme) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      compiler: 'xelatex',
      autoCompile: false,
      theme: 'dark',
      setCompiler: (compiler) => set({ compiler }),
      setAutoCompile: (autoCompile) => set({ autoCompile }),
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'latex-studio-settings' }
  )
);
