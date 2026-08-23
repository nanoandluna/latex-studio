import { useEditorStore } from '../../stores/editorStore';
import { MonacoPane } from './MonacoPane';

function fileIcon(name: string): string {
  if (name.endsWith('.tex')) return 'TEX';
  if (name.endsWith('.bib')) return 'BIB';
  if (/\.(png|jpe?g|svg|pdf)$/i.test(name)) return 'IMG';
  return '·  ';
}

export function EditorPane() {
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const setActive = useEditorStore((s) => s.setActive);
  const closeTab = useEditorStore((s) => s.closeTab);
  const isDirty = useEditorStore((s) => s.isDirty);

  return (
    <div className="flex h-full min-w-0 flex-col">
      {tabs.length > 0 && (
        <div data-testid="tab-strip" className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-[#1c1c1f]">
          {tabs.map((t) => {
            const name = t.path.split('/').pop()!;
            const dirty = isDirty(t);
            const active = t.path === activePath;
            return (
              <button
                key={t.path}
                onClick={() => setActive(t.path)}
                title={t.path}
                className={`group flex items-center gap-2 border-r border-zinc-200 px-3 text-xs whitespace-nowrap dark:border-zinc-800 ${
                  active
                    ? 'bg-white text-zinc-900 dark:bg-[#18181b] dark:text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                <span className="font-mono text-[10px] opacity-60">{fileIcon(name)}</span>
                <span>
                  {name}
                  {dirty ? ' *' : ''}
                </span>
                <span
                  role="button"
                  aria-label={`Close ${name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const t2 = useEditorStore.getState().tabs.find((x) => x.path === t.path);
                    if (t2 && isDirty(t2)) {
                      const save = window.confirm(
                        `${name} has unsaved changes.\n\nOK = save and close, Cancel = keep the tab open.`
                      );
                      if (save) {
                        void useEditorStore.getState().saveFile(t.path).then(() => closeTab(t.path));
                        return;
                      }
                      if (!window.confirm(`Discard changes to ${name}?`)) return;
                    }
                    closeTab(t.path);
                  }}
                  className="ml-1 rounded px-1 opacity-40 hover:bg-zinc-200 hover:opacity-100 dark:hover:bg-zinc-700"
                >
                  ×
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <MonacoPane />
      </div>
    </div>
  );
}
