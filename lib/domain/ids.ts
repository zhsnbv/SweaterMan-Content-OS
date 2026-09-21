import { randomUUID } from 'node:crypto';

/** Stable, human-readable content unit id: CU-2026-W40-03. */
export function contentUnitId(weekId: string, index: number): string {
  return `CU-${weekId}-${String(index).padStart(2, '0')}`;
}

/** Core video id: V027. */
export function coreVideoId(n: number): string {
  return `V${String(n).padStart(3, '0')}`;
}

export function nextCoreVideoNumber(existingIds: string[]): number {
  const nums = existingIds
    .map((id) => /^V(\d+)$/.exec(id)?.[1])
    .filter((x): x is string => Boolean(x))
    .map(Number);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

export function uid(prefix = ''): string {
  const id = typeof randomUUID === 'function' ? randomUUID() : Math.random().toString(36).slice(2);
  return prefix ? `${prefix}_${id}` : id;
}

export function slugId(prefix: string, seed: string): string {
  const base = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${prefix}-${base || 'item'}`;
}
