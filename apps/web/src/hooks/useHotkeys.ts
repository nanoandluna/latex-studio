import { useEffect } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useBuildStore } from '../stores/buildStore';
import { useUiStore } from '../stores/uiStore';
import { useSnapshotStore } from '../stores/snapshotStore';

/**
 * Global IDE hotkeys.
 *
 * Ctrl+S        save active file
 * Ctrl+Shift+S  take a manual snapshot (must not fall through to save)
 * Ctrl+B        build
 * Ctrl+P        quick open
 * Ctrl+Shift+P  command palette
 * Ctrl+Shift+F  project search
 */
export function useHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      const key = e.key.toLowerCase();

      if (key === 's' && e.shiftKey) {
        e.preventDefault();
        void useSnapshotStore.getState().create('manual', 'hotkey');
        showPanel('history');
      } else if (key === 's') {
        e.preventDefault();
        void useEditorStore.getState().saveActive();
      } else if (key === 'f' && e.shiftKey) {
        e.preventDefault();
        showPanel('search');
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

/** Reveal the sidebar if it is hidden, then ask it to switch tabs. */
export function showPanel(panel: 'search' | 'history'): void {
  const ui = useUiStore.getState();
  if (!ui.explorerVisible) ui.toggleExplorer();
  window.dispatchEvent(new CustomEvent('latex-studio:show-panel', { detail: { panel } }));
}
