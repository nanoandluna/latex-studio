import { useState } from 'react';
import { FileTree } from './FileTree';
import { OutlinePanel } from './OutlinePanel';
import { NavigatorPanel } from './NavigatorPanel';

type Tab = 'explorer' | 'outline' | 'navigator';

const TABS: { key: Tab; label: string }[] = [
  { key: 'explorer', label: 'Explorer' },
  { key: 'outline', label: 'Outline' },
  { key: 'navigator', label: 'Navigator' },
];

export function Sidebar() {
  const [tab, setTab] = useState<Tab>('explorer');

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex h-8 shrink-0 items-stretch gap-0.5 border-b border-zinc-200 px-1 dark:border-zinc-800"
        role="tablist"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-2 text-[11px] font-medium ${
              tab === t.key
                ? 'border-b-2 border-blue-500 text-zinc-900 dark:text-zinc-100'
                : 'border-b-2 border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pt-1">
        {tab === 'explorer' && <FileTree />}
        {tab === 'outline' && <OutlinePanel />}
        {tab === 'navigator' && <NavigatorPanel />}
      </div>
    </div>
  );
}
