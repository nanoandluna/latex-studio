import { useEffect, useState } from 'react';
import { FileTree } from './FileTree';
import { OutlinePanel } from './OutlinePanel';
import { NavigatorPanel } from './NavigatorPanel';
import { SearchPanel } from '../search/SearchPanel';
import { HistoryPanel } from '../history/HistoryPanel';

type Tab = 'explorer' | 'search' | 'history' | 'outline' | 'navigator';

const TABS: { key: Tab; label: string }[] = [
  { key: 'explorer', label: 'Explorer' },
  { key: 'search', label: 'Search' },
  { key: 'history', label: 'History' },
  { key: 'outline', label: 'Outline' },
  { key: 'navigator', label: 'Navigator' },
];

export function Sidebar() {
  const [tab, setTab] = useState<Tab>('explorer');

  // Ctrl+Shift+F / Ctrl+Shift+S reveal and focus the search / history panels.
  useEffect(() => {
    const onShow = (e: Event) => {
      const which = (e as CustomEvent<{ panel: Tab }>).detail?.panel;
      if (!which) return;
      setTab(which);
      if (which === 'search') {
        requestAnimationFrame(() =>
          window.dispatchEvent(new CustomEvent('latex-studio:focus-search'))
        );
      }
    };
    window.addEventListener('latex-studio:show-panel', onShow);
    return () => window.removeEventListener('latex-studio:show-panel', onShow);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex h-8 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-zinc-200 px-1 dark:border-zinc-800"
        role="tablist"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 px-1.5 text-xs font-medium ${
              tab === t.key
                ? 'border-b-2 border-blue-500 text-zinc-900 dark:text-zinc-100'
                : 'border-b-2 border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Search owns its own scrolling; the rest scroll here. */}
      <div
        className={
          tab === 'search' ? 'min-h-0 flex-1' : 'min-h-0 flex-1 overflow-y-auto pt-1'
        }
      >
        {tab === 'explorer' && <FileTree />}
        {tab === 'search' && <SearchPanel />}
        {tab === 'history' && <HistoryPanel />}
        {tab === 'outline' && <OutlinePanel />}
        {tab === 'navigator' && <NavigatorPanel />}
      </div>
    </div>
  );
}
