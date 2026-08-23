import { useEffect } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useBuildStore } from '../stores/buildStore';
import { useUiStore } from '../stores/uiStore';

/** Global IDE hotkeys: Ctrl+S, Ctrl+B, Ctrl+P (quick open), Ctrl+Shift+P (palette). */
export function useHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      const key = e.key.toLowerCase();

      if (key === 's') {
        e.preventDefault();
        void useEditorStore.getState().saveActive();
      } else if (key === 'b') {
        e.preventDefault();
        void useBuildStore.getState().build();
      } else if (key === 'p' && e.shiftKey) {
        e.preventDefault();
        const ui = useUiStore.getState();
        ui.setPaletteOpen(!ui.paletteOpen);
      } else if (key === 'p') {
        e.preventDefault();
        // Quick open: focus the command palette pre-filled for file search
        useUiStore.getState().setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
