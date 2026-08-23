import { useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useBuildStore } from '../stores/buildStore';
import { useSettingsStore } from '../stores/settingsStore';

const DEBOUNCE_MS = 1000;

/**
 * Auto Compile: after every save, debounce 1s then build.
 * Never queues more than one pending timer; skips while a build is running
 * and re-arms afterwards so the latest save always gets compiled.
 */
export function useAutoBuild(): void {
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const onSave = () => {
      const { autoCompile } = useSettingsStore.getState();
      if (!autoCompile) return;

      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const bs = useBuildStore.getState();
        // Build in flight: remember the save so one catch-up rebuild runs
        // after the current build completes (see buildStore.build()).
        if (bs.status === 'running' || bs.status === 'starting' || bs.status === 'queued') {
          useBuildStore.setState({ dirtySinceBuild: true });
          return;
        }
        void bs.build();
      }, DEBOUNCE_MS);
    };
    window.addEventListener('latex-studio:saved', onSave);
    return () => {
      window.removeEventListener('latex-studio:saved', onSave);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);
}
