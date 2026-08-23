import { useEffect, useMemo, useRef, useState } from 'react';
import { useUiStore } from '../../stores/uiStore';
import { useBuildStore } from '../../stores/buildStore';
import { useEditorStore } from '../../stores/editorStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useSettingsStore, type CompilerChoice } from '../../stores/settingsStore';

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const build = useBuildStore((s) => s.build);
  const saveActive = useEditorStore((s) => s.saveActive);
  const workspace = useWorkspaceStore((s) => s);
  const ui = useUiStore((s) => s);
  const setCompiler = useSettingsStore((s) => s.setCompiler);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const openFile = useEditorStore((s) => s.openFile);

  const fileCommands = useMemo<Command[]>(() => {
    const out: Command[] = [];
    const walk = (node: typeof workspace.tree) => {
      if (!node) return;
      for (const child of node.children ?? []) {
        if (child.type === 'directory') walk(child);
        else if (out.length < 200) {
          out.push({
            id: `file:${child.path}`,
            label: child.name,
            hint: child.path,
            run: () => void openFile(child.path),
          });
        }
      }
    };
    walk(workspace.tree);
    return out;
  }, [workspace.tree, openFile]);

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      { id: 'build', label: 'Build', hint: 'Ctrl+B', run: () => void build() },
      { id: 'save', label: 'Save File', hint: 'Ctrl+S', run: () => void saveActive() },
      {
        id: 'open-workspace',
        label: 'Open Workspace…',
        run: () => ui.setWorkspaceModalOpen(true),
      },
      { id: 'toggle-explorer', label: 'Toggle Explorer', run: () => ui.toggleExplorer() },
      { id: 'reload', label: 'Reload Workspace Tree', run: () => void workspace.refreshTree() },
      { id: 'detect-main', label: 'Re-detect Main File', run: () => void workspace.detectMainFile().then((f) => f && workspace.setMainFile(f)) },
    ];
    for (const c of ['auto', 'latexmk', 'xelatex', 'pdflatex', 'lualatex'] as CompilerChoice[]) {
      cmds.push({
        id: `compiler-${c}`,
        label: `Change Compiler: ${c}`,
        run: () => setCompiler(c),
      });
    }
    for (const t of ['dark', 'light', 'system'] as const) {
      cmds.push({ id: `theme-${t}`, label: `Theme: ${t}`, run: () => setTheme(t) });
    }
    return cmds;
  }, [build, saveActive, ui, workspace, setCompiler, setTheme]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (c: Command) => !q || c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q);
    // Ctrl+P style: if query looks like a filename, files first
    return [...fileCommands, ...commands].filter(match).slice(0, 50);
  }, [commands, fileCommands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  if (!open) return null;

  const execute = (cmd?: Command) => {
    if (!cmd) return;
    setOpen(false);
    cmd.run();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[520px] max-w-[90vw] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter') {
              execute(filtered[selected]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder="Type a command…"
          className="w-full border-b border-zinc-200 bg-transparent px-4 py-3 text-sm outline-none dark:border-zinc-700"
        />
        <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-2 text-xs text-zinc-400">No matching commands</div>
          )}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              onClick={() => execute(c)}
              onMouseEnter={() => setSelected(i)}
              className={`flex w-full items-center justify-between px-4 py-1.5 text-left text-sm ${
                i === selected
                  ? 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200'
                  : ''
              }`}
            >
              <span>{c.label}</span>
              {c.hint && <span className="text-[10px] text-zinc-400">{c.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
