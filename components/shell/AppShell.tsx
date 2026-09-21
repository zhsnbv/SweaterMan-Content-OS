'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarDays,
  Clapperboard,
  Lightbulb,
  BookOpen,
  FileText,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/week', label: 'Week', icon: CalendarDays },
  { href: '/core-videos', label: 'Core videos', icon: Clapperboard },
  { href: '/backlog', label: 'Backlog', icon: Lightbulb },
  { href: '/insights', label: 'Insights', icon: BookOpen },
  { href: '/context', label: 'Context', icon: FileText },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith('/setup')) return <>{children}</>;

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <nav className="flex w-[188px] shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface-2)] max-md:w-[56px]">
        <div className="flex h-[46px] items-center gap-2 px-3">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-[var(--color-ink)] text-[10px] font-bold text-white">
            S
          </div>
          <span className="text-[13px] font-semibold tracking-tight max-md:hidden">
            Content OS
          </span>
        </div>

        <div className="flex flex-col gap-px px-2 py-1">
          {NAV.map((item) => {
            const active = pathname?.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] font-medium transition-colors max-md:justify-center',
                  active
                    ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[0_0_0_1px_var(--color-line)]'
                    : 'text-[var(--color-ink-2)] hover:bg-[#ededf1] hover:text-[var(--color-ink)]',
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="max-md:hidden">{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="mt-auto px-3 py-3 text-[10px] leading-relaxed text-[var(--color-ink-3)] max-md:hidden">
          Sweater Man workspace
        </div>
      </nav>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
