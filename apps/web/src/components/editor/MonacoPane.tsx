import Editor, { type OnMount } from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import * as monacoNs from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import { authedFetch } from '../../api/client';
import { useEditorStore } from '../../stores/editorStore';
import { useBuildStore } from '../../stores/buildStore';
import { usePreviewStore } from '../../stores/previewStore';
import { useSettingsStore } from '../../stores/settingsStore';

// Bundle Monaco locally — the app must work fully offline.
loader.config({ monaco: monacoNs });

export function MonacoPane() {
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const updateContent = useEditorStore((s) => s.updateContent);
  const setCursorLine = useEditorStore((s) => s.setCursorLine);
  const revealTarget = useEditorStore((s) => s.revealTarget);
  const clearReveal = useEditorStore((s) => s.clearReveal);
  const theme = useSettingsStore((s) => s.theme);
  const editorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);

  const tab = tabs.find((t) => t.path === activePath);
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    return () => {
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []);

  // Reveal a target line (from Problems click / go-to-line)
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !revealTarget || revealTarget.path !== activePath) return;
    ed.revealLineInCenter(revealTarget.line);
    ed.setPosition({ lineNumber: revealTarget.line, column: 1 });
    ed.focus();
    clearReveal();
  }, [revealTarget, activePath, clearReveal]);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.onDidChangeCursorPosition((e) => {
      if (activePath) setCursorLine(activePath, e.position.lineNumber);
    });
    // Ctrl+Click (Cmd+Click) on a source line → SyncTeX forward search.
    editor.onMouseDown(async (e) => {
      if (!(e.event.ctrlKey || e.event.metaKey)) return;
      const line = e.target.position?.lineNumber;
      if (!line || !activePath) return;
      try {
        const buildId = useBuildStore.getState().buildId;
        const res = await authedFetch('/api/synctex/forward', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ buildId, file: activePath, line }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { page: number };
        if (data.page) usePreviewStore.getState().setPage(data.page);
      } catch {
        /* synctex unavailable — ignore */
      }
    });
  };

  if (!tab) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500 select-none">
        Open a file from the Explorer to start editing
      </div>
    );
  }

  return (
    <Editor
      key={tab.path}
      height="100%"
      defaultLanguage="latex"
      language="latex"
      path={tab.path}
      value={tab.content}
      theme={dark ? 'latex-studio-dark' : 'vs'}
      onChange={(v) => updateContent(tab.path, v ?? '')}
      onMount={handleMount}
      options={{
        fontSize: 14,
        minimap: { enabled: true },
        automaticLayout: true,
        wordWrap: 'on',
        tabSize: 2,
        renderWhitespace: 'selection',
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        bracketPairColorization: { enabled: true },
        padding: { top: 8 },
      }}
    />
  );
}
