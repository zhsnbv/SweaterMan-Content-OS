import type { ContentUnit, PlatformVariant } from '@/lib/domain/schema';
import { PLATFORM_LABEL } from '@/lib/domain/enums';

export type FieldDiff = {
  field: string;
  label: string;
  before: string;
  after: string;
};

const SCALAR_FIELDS: Array<[keyof ContentUnit, string]> = [
  ['title', 'Title'],
  ['date', 'Date'],
  ['scheduled_time', 'Time'],
  ['content_type', 'Type'],
  ['slot_type', 'Slot'],
  ['objective', 'Objective'],
  ['hypothesis', 'Hypothesis'],
  ['expected_signal', 'Expected signal'],
  ['estimated_effort', 'Effort'],
  ['status', 'Status'],
  ['owner', 'Owner'],
  ['notes', 'Notes'],
  ['source', 'Source'],
  ['related_core_video_id', 'Core video'],
  ['figma_url', 'Figma'],
];

const VARIANT_FIELDS: Array<[keyof PlatformVariant, string]> = [
  ['surface', 'surface'],
  ['format', 'format'],
  ['hook', 'hook'],
  ['ready_to_use_copy', 'copy'],
  ['visual_instruction', 'visual'],
  ['cta', 'CTA'],
  ['publish_status', 'publish status'],
  ['publish_url', 'publish URL'],
];

const short = (v: unknown, max = 90): string => {
  const s = v === null || v === undefined ? '—' : String(v);
  const clean = s.replace(/\s+/g, ' ').trim() || '—';
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/**
 * Variants are matched by their stable id first. Keying on platform/surface
 * alone would report a carousel that became a Story as a delete plus an add,
 * which hides the one thing the user actually asked for.
 */
const variantKey = (v: PlatformVariant): string => v.id || `${v.platform}/${v.surface}`;
const variantLabel = (v: PlatformVariant): string =>
  `${PLATFORM_LABEL[v.platform]} ${v.surface.replace(/_/g, ' ')}`;

/** Structural diff between two versions of a unit, used for revisions and the UI. */
export function diffUnits(before: ContentUnit, after: ContentUnit): FieldDiff[] {
  const out: FieldDiff[] = [];

  for (const [field, label] of SCALAR_FIELDS) {
    const a = before[field];
    const b = after[field];
    if (String(a ?? '') !== String(b ?? '')) {
      out.push({ field: String(field), label, before: short(a), after: short(b) });
    }
  }

  const beforeMap = new Map(before.platforms.map((v) => [variantKey(v), v]));
  const afterMap = new Map(after.platforms.map((v) => [variantKey(v), v]));

  for (const [key, bv] of beforeMap) {
    if (!afterMap.has(key)) {
      out.push({
        field: `platforms.${key}`,
        label: `Removed ${variantLabel(bv)}`,
        before: short(bv.hook || bv.ready_to_use_copy),
        after: '—',
      });
    }
  }

  for (const [key, av] of afterMap) {
    const bv = beforeMap.get(key);
    if (!bv) {
      out.push({
        field: `platforms.${key}`,
        label: `Added ${variantLabel(av)}`,
        before: '—',
        after: short(av.hook || av.ready_to_use_copy),
      });
      continue;
    }
    for (const [f, fl] of VARIANT_FIELDS) {
      if (String(bv[f] ?? '') !== String(av[f] ?? '')) {
        out.push({
          field: `platforms.${key}.${String(f)}`,
          label: `${variantLabel(av)} — ${fl}`,
          before: short(bv[f]),
          after: short(av[f]),
        });
      }
    }
  }

  return out;
}

/** One-paragraph, human-readable summary of a diff. Shown in chat and stored. */
export function summarizeDiff(diffs: FieldDiff[]): string {
  if (!diffs.length) return 'Ничего не изменилось.';
  return diffs.map((d) => `• ${d.label}: ${d.before} → ${d.after}`).join('\n');
}
