'use client';

import * as React from 'react';
import {
  Compass,
  Users,
  Wrench,
  GraduationCap,
  BadgeDollarSign,
  Clapperboard,
} from 'lucide-react';
import type { ContentType, Platform } from '@/lib/domain/enums';
import { cn } from '@/lib/utils';
import { Chip } from './primitives';

const TYPE_ICON: Record<ContentType, React.ComponentType<{ className?: string }>> = {
  DISCOVERY: Compass,
  AUDIENCE: Users,
  PROCESS: Wrench,
  AUTHORITY: GraduationCap,
  COMMERCIAL: BadgeDollarSign,
  CORE: Clapperboard,
};

const TYPE_COLOR: Record<ContentType, string> = {
  DISCOVERY: 'text-[var(--color-t-discovery)]',
  AUDIENCE: 'text-[var(--color-t-audience)]',
  PROCESS: 'text-[var(--color-t-process)]',
  AUTHORITY: 'text-[var(--color-t-authority)]',
  COMMERCIAL: 'text-[var(--color-t-commercial)]',
  CORE: 'text-[var(--color-t-core)]',
};

const TYPE_CHIP: Record<ContentType, string> = {
  DISCOVERY: 'border-[#e4dcff] bg-[#f5f1ff] text-[#5b3fd6]',
  AUDIENCE: 'border-[#c9ece0] bg-[#eefaf5] text-[#087f55]',
  PROCESS: 'border-[#f4dfc0] bg-[#fdf6ec] text-[#a35d06]',
  AUTHORITY: 'border-[#cfdefb] bg-[#eff4fe] text-[#1d4ed8]',
  COMMERCIAL: 'border-[#f8cfe3] bg-[#fdf0f7] text-[#be185d]',
  CORE: 'border-[#d8d8de] bg-[#f1f1f4] text-[#17171b]',
};

export function TypeIcon({ type, className }: { type: ContentType; className?: string }) {
  const Icon = TYPE_ICON[type];
  return <Icon className={cn('h-3.5 w-3.5', TYPE_COLOR[type], className)} />;
}

export function TypeChip({ type }: { type: ContentType }) {
  return <Chip className={TYPE_CHIP[type]}>{type}</Chip>;
}

/*
 * Platform marks are two-letter monospace badges rather than brand logos:
 * they stay legible at 10px, scan instantly in a dense calendar, and avoid
 * shipping third-party trademarks inside the product UI.
 */
const PLATFORM_MARK: Record<Platform, { short: string; className: string }> = {
  instagram: { short: 'IG', className: 'bg-[#fdf0f7] text-[#be185d] border-[#f8cfe3]' },
  tiktok: { short: 'TT', className: 'bg-[#f1f1f4] text-[#17171b] border-[#d8d8de]' },
  youtube: { short: 'YT', className: 'bg-[#fef2f2] text-[#b42318] border-[#fecdca]' },
  telegram: { short: 'TG', className: 'bg-[#eff4fe] text-[#1d4ed8] border-[#cfdefb]' },
};

export function PlatformIcon({
  platform,
  className,
}: {
  platform: Platform;
  className?: string;
}) {
  const mark = PLATFORM_MARK[platform];
  return (
    <span
      className={cn(
        'inline-flex h-[14px] items-center rounded-[3px] border px-[3px] font-mono text-[9px] font-semibold leading-none tracking-tight',
        mark.className,
        className,
      )}
    >
      {mark.short}
    </span>
  );
}

export function PlatformChip({
  platform,
  surface,
}: {
  platform: Platform;
  surface?: string;
}) {
  return (
    <span
      title={`${platform}${surface ? ` / ${surface}` : ''}`}
      className="inline-flex items-center gap-1 text-[10px] text-[var(--color-ink-2)]"
    >
      <PlatformIcon platform={platform} />
      {surface ? <span className="lowercase">{surface.replace(/_/g, ' ')}</span> : null}
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  idea: 'text-[var(--color-ink-3)]',
  drafted: 'text-[var(--color-ink-2)]',
  ready: 'text-[#087f55]',
  scheduled: 'text-[#1d4ed8]',
  published: 'text-[#087f55]',
  skipped: 'text-[var(--color-ink-3)] line-through',
};

export function StatusText({ status }: { status: string }) {
  return (
    <span className={cn('text-[10px] font-medium capitalize', STATUS_STYLE[status])}>
      {status}
    </span>
  );
}
