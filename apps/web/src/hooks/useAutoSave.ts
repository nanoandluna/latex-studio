import { useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useSnapshotStore } from '../stores/snapshotStore';
import {
  useSettingsStore,
  AUTO_SAVE_INTERVAL_MS,
  type AutoSavePolicy,
} from '../stores/settingsStore';

/**
 * V0.4 auto-save, plus the optional `auto` snapshot on focus loss.
 *
 * Auto-save writes dirty tabs through the ordinary save pipeline and
 * deliberately takes no snapshot: a snapshot is a version the user asked to
 * keep, and firing one every 30 seconds would bury the history in noise.
 *
 * The `auto` snapshot is a separate opt-in switch — it only fires when the
 * window loses focus AND something is unsaved.
 */
export function useAutoSave(): void {
  const policy = useSettingsStore((s) => s.autoSave);
  const autoSnapshot = useSettingsStore((s) => s.autoSnapshot);
  const running = useRef(false);

  useEffect(() => {
    const saveDirty = async () => {
      // Guard against overlapping runs — a slow save must not stack up.
      if (running.current) return;
      running.current = true;
      try {
        const { tabs, isDirty, saveFile } = useEditorStore.getState();
        for (const tab of tabs) {
          if (isDirty(tab)) {
            try {
              await saveFile(tab.path);
            } catch {
              /* leave the tab dirty; the user still has an explicit save */
            }
          }
        }
      } finally {
        running.current = false;
      }
    };

    if (policy === 'off') return;

    if (policy === 'focus-loss') {
      const onBlur = () => void saveDirty();
      window.addEventListener('blur', onBlur);
      return () => window.removeEventListener('blur', onBlur);
    }

    const timer = window.setInterval(() => void saveDirty(), AUTO_SAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [policy]);

  // Auto snapshot on focus loss — only when there is unsaved work to protect.
  useEffect(() => {
    if (!autoSnapshot) return;
    const onBlur = () => {
      const { tabs, isDirty } = useEditorStore.getState();
      if (!tabs.some(isDirty)) return;
      void useSnapshotStore.getState().create('auto', 'window lost focus').catch(() => {});
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [autoSnapshot]);
}

/** Exposed for the settings UI. */
export const AUTO_SAVE_OPTIONS: { value: AutoSavePolicy; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'interval', label: 'Every 30 seconds' },
  { value: 'focus-loss', label: 'On focus loss' },
];
