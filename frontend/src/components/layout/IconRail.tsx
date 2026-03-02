import type { ReactNode } from 'react';
import { Activity as ActivityIcon, CheckSquare, FileText, LayoutGrid, Moon, PawPrint, Settings, Sun } from 'lucide-react';
import { IconButton } from '../ui/Button';
import type { ResolvedTheme } from '../../hooks/useTheme';

export type AppTab = 'kanban' | 'inbox' | 'activity' | 'docs' | 'settings';

export function IconRail({
  tab,
  onTab,
  theme,
  onToggleTheme,
}: {
  tab: AppTab;
  onTab: (t: AppTab) => void;
  theme: ResolvedTheme;
  onToggleTheme: () => void;
}) {
  const items: Array<{ key: AppTab; label: string; icon: ReactNode }> = [
    { key: 'kanban', label: 'Projects', icon: <LayoutGrid size={18} strokeWidth={2} /> },
    { key: 'inbox', label: 'Inbox', icon: <CheckSquare size={18} strokeWidth={2} /> },
    { key: 'activity', label: 'Activity', icon: <ActivityIcon size={18} strokeWidth={2} /> },
    { key: 'docs', label: 'Docs', icon: <FileText size={18} strokeWidth={2} /> },
  ];

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center gap-3 bg-[rgb(var(--cb-accent))] py-3">
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/30 bg-white/16 text-sm font-black tracking-[0.08em] text-white shadow-[0_4px_14px_rgb(2_6_23/0.22)] transition hover:bg-white/22"
        title="Pawvy"
        aria-label="Pawvy"
        onClick={() => onTab('kanban')}
      >
        <PawPrint size={18} strokeWidth={2.4} />
      </button>

      <div className="flex flex-1 flex-col items-center gap-2">
        {items.map((it) => (
          <IconButton
            key={it.key}
            label={it.label}
            active={tab === it.key}
            onClick={() => onTab(it.key)}
            className={
              tab === it.key
                ? '!bg-white/24 !text-white ring-1 ring-white/35'
                : '!text-white/78 hover:!bg-white/14 hover:!text-white'
            }
          >
            {it.icon}
          </IconButton>
        ))}
      </div>

      <div className="flex flex-col items-center gap-2">
        <IconButton
          label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          onClick={onToggleTheme}
          className="!text-white/78 hover:!bg-white/14 hover:!text-white"
        >
          {theme === 'dark' ? <Sun size={18} strokeWidth={2} /> : <Moon size={18} strokeWidth={2} />}
        </IconButton>
        <IconButton
          label="Settings"
          active={tab === 'settings'}
          onClick={() => onTab('settings')}
          className={
            tab === 'settings'
              ? '!bg-white/24 !text-white ring-1 ring-white/35'
              : '!text-white/78 hover:!bg-white/14 hover:!text-white'
          }
        >
          <Settings size={18} strokeWidth={2} />
        </IconButton>
      </div>
    </aside>
  );
}
