import { useState, useCallback } from 'react';
import type { FileNode } from '@latex-studio/shared';
import { api } from '../../api/client';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useEditorStore } from '../../stores/editorStore';

function fileIcon(node: FileNode): string {
  if (node.type === 'directory') return '📁';
  const n = node.name.toLowerCase();
  if (n.endsWith('.tex')) return '📄';
  if (n.endsWith('.bib')) return '📚';
  if (/\.(png|jpe?g|svg|gif)$/.test(n)) return '🖼️';
  if (n.endsWith('.pdf')) return '📕';
  if (n.endsWith('.sty') || n.endsWith('.cls')) return '🎨';
  if (n === '.build' || n.startsWith('.')) return '⚙️';
  return '📄';
}

export function FileTree() {
  const tree = useWorkspaceStore((s) => s.tree);
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (!tree) return null;

  const toggle = (path: string) => setExpanded((e) => ({ ...e, [path]: !e[path] }));

  const renderNode = (node: FileNode, depth: number) => {
    if (node.type === 'directory') {
      const isOpen = expanded[node.path] ?? depth === 0;
      return (
        <div key={node.path || '__root'}>
          <div
            className="flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onClick={() => toggle(node.path)}
          >
            <span className="w-3 text-zinc-400">{isOpen ? '▾' : '▸'}</span>
            <span>{fileIcon(node)}</span>
            <span className="truncate font-medium">{node.name}</span>
          </div>
          {isOpen &&
            node.children?.map((c) => renderNode(c, depth + 1))}
        </div>
      );
    }
    return <LeafFile key={node.path} node={node} depth={depth} />;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between px-2 text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
        <span>Explorer</span>
        <div className="flex gap-1">
          <IconButton title="New file" onClick={() => handleCreate('file')} icon="+📄" />
          <IconButton title="New folder" onClick={() => handleCreate('directory')} icon="+📁" />
          <IconButton title="Refresh" onClick={() => void refreshTree()} icon="⟳" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">{tree.children?.map((c) => renderNode(c, 0))}</div>
    </div>
  );

  function IconButton({ title, onClick, icon }: { title: string; onClick: () => void; icon: string }) {
    return (
      <button
        title={title}
        onClick={onClick}
        className="rounded px-1 py-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700"
      >
        {icon}
      </button>
    );
  }

  async function handleCreate(type: 'file' | 'directory') {
    const name = window.prompt(type === 'file' ? 'New file path:' : 'New folder path:');
    if (!name) return;
    try {
      if (type === 'file') await api.createFile(name);
      else await api.createDirectory(name);
      await refreshTree();
    } catch (err) {
      alert((err as Error).message);
    }
  }
}

function LeafFile({ node, depth }: { node: FileNode; depth: number }) {
  const openFile = useEditorStore((s) => s.openFile);
  const activePath = useEditorStore((s) => s.activePath);
  const tabs = useEditorStore((s) => s.tabs);
  const isDirty = useEditorStore((s) => s.isDirty);
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);
  const [menuOpen, setMenuOpen] = useState(false);

  const dirtyTab = tabs.find((t) => t.path === node.path);
  const dirty = dirtyTab && isDirty(dirtyTab);

  const doDelete = useCallback(async () => {
    if (!window.confirm(`Delete ${node.path}?`)) return;
    try {
      await api.deleteFile(node.path);
      await refreshTree();
    } catch (err) {
      alert((err as Error).message);
    }
  }, [node.path, refreshTree]);

  const doRename = useCallback(async () => {
    const to = window.prompt('Rename to:', node.path);
    if (!to || to === node.path) return;
    try {
      await api.renameFile(node.path, to);
      await refreshTree();
    } catch (err) {
      alert((err as Error).message);
    }
  }, [node.path, refreshTree]);

  return (
    <div className="group relative flex items-center" onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); setTimeout(() => setMenuOpen(false), 4000); }}>
      <button
        onClick={async () => {
          if (/\.(tex|bib|txt|md|sty|cls|json)$/i.test(node.name)) await openFile(node.path);
        }}
        className={`flex w-full items-center gap-1 rounded px-2 py-0.5 text-left text-xs ${
          activePath === node.path
            ? 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200'
            : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
        }`}
        style={{ paddingLeft: `${20 + depth * 14}px` }}
      >
        <span>{fileIcon(node)}</span>
        <span className="truncate">
          {node.name}
          {dirty ? ' *' : ''}
        </span>
      </button>
      <button
        title="More actions"
        className="absolute right-1 hidden rounded px-1 text-[10px] text-zinc-400 group-hover:block hover:text-zinc-700 dark:hover:text-zinc-200"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
      >
        ⋯
      </button>
      {menuOpen && (
        <div className="absolute right-1 z-20 mt-16 flex flex-col rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <MenuItem label="Rename" onClick={() => { setMenuOpen(false); void doRename(); }} />
          <MenuItem label="Delete" onClick={() => { setMenuOpen(false); void doDelete(); }} danger />
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-left text-xs ${
        danger
          ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950'
          : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
      }`}
    >
      {label}
    </button>
  );
}
