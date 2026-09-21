import type { Store } from '@/lib/store';
import { learningSchema, type ContentUnit, type Learning } from '@/lib/domain/schema';
import type { Confidence, LearningCategory } from '@/lib/domain/enums';
import { slugId, uid } from '@/lib/domain/ids';

/**
 * Evidence rules, straight out of the brief and the strategy docs:
 *   1 data point                   → LOW
 *   several comparable results     → at most MEDIUM
 *   a repeated, stable pattern     → HIGH
 * Repeated operational feedback from the team counts as evidence too.
 */
export function confidenceForEvidence(
  evidenceCount: number,
  opts: { repeatedPattern?: boolean; operationalFeedback?: boolean } = {},
): Confidence {
  if (evidenceCount <= 1) return 'LOW';
  if (opts.operationalFeedback && evidenceCount >= 3) return 'HIGH';
  if (opts.repeatedPattern && evidenceCount >= 4) return 'HIGH';
  if (evidenceCount >= 2) return 'MEDIUM';
  return 'LOW';
}

export type RecordLearningInput = {
  category: LearningCategory;
  observation: string;
  evidence: string[];
  action?: string;
  tags?: string[];
  sourceUnits?: string[];
  confidence?: Confidence;
  repeatedPattern?: boolean;
  operationalFeedback?: boolean;
};

/**
 * Learnings are append-only. An observation that repeats an existing one adds
 * evidence and may raise confidence; it never silently rewrites history — the
 * old learning is marked superseded and kept.
 */
export async function recordLearning(
  store: Store,
  workspaceId: string,
  input: RecordLearningInput,
): Promise<Learning> {
  if (!input.evidence.length) {
    throw new Error('A learning without evidence is not a learning. Provide at least one source.');
  }

  const existing = await store.listLearnings();
  const key = normalizeObservation(input.observation);
  const prior = existing.find(
    (l) => !l.superseded_by && normalizeObservation(l.observation) === key,
  );

  const evidence = Array.from(new Set([...(prior?.evidence ?? []), ...input.evidence]));
  const sourceUnits = Array.from(
    new Set([...(prior?.source_units ?? []), ...(input.sourceUnits ?? [])]),
  );

  const confidence =
    input.confidence ??
    confidenceForEvidence(evidence.length, {
      repeatedPattern: input.repeatedPattern,
      operationalFeedback: input.operationalFeedback,
    });

  const learning = learningSchema.parse({
    id: prior ? uid('lrn') : slugId('lrn', input.observation),
    workspace_id: workspaceId,
    created_at: new Date().toISOString(),
    category: input.category,
    observation: input.observation,
    evidence,
    confidence,
    action: input.action ?? prior?.action ?? '',
    tags: Array.from(new Set([...(prior?.tags ?? []), ...(input.tags ?? [])])),
    source_units: sourceUnits,
    superseded_by: null,
  });

  await store.saveLearning(learning);
  if (prior) {
    await store.saveLearning({ ...prior, superseded_by: learning.id });
  }
  return learning;
}

function normalizeObservation(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/* ------------------------------------------------------------------ *
 * Operational feedback detector
 * ------------------------------------------------------------------ */

const FEEDBACK_THEMES: Array<{
  tag: string;
  test: RegExp;
  observation: string;
  action: string;
  category: LearningCategory;
}> = [
  {
    tag: 'effort:carousel',
    test: /карусел|carousel/i,
    observation:
      "Large custom carousels exceed the team's supporting-content effort budget.",
    action: 'Prefer Story or a ≤4-card carousel unless the user specifically asks for more.',
    category: 'production',
  },
  {
    tag: 'effort:too-long',
    test: /долго|дорого|не успе|много работы|слишком трудоём|10 минут|быстрее|упрост/i,
    observation:
      'Supporting units are repeatedly rejected as too time-consuming to execute.',
    action: 'Default supporting units to XS–S effort and reuse material that already exists.',
    category: 'production',
  },
  {
    tag: 'tone:complex',
    test: /сложно|непонятно|перегруж/i,
    observation: 'Copy is repeatedly flagged as too complex for the audience.',
    action: 'Keep one idea per post, short sentences, conversational "ты".',
    category: 'content',
  },
  {
    tag: 'tone:funnier',
    test: /смешн|скучн|сух[ио]|юмор/i,
    observation: 'The team repeatedly asks for a funnier, drier tone in supporting copy.',
    action: 'Lean into dry black humour in hooks and closing lines; no exclamation marks.',
    category: 'content',
  },
];

/**
 * Turns repeated free-text feedback into evidence-backed learnings. Fires only
 * at three or more independent units, which is what makes it HIGH confidence.
 */
export async function learningsFromFeedback(
  store: Store,
  workspaceId: string,
  units: ContentUnit[],
  threshold = 3,
): Promise<Learning[]> {
  const created: Learning[] = [];

  for (const theme of FEEDBACK_THEMES) {
    const hits = units.filter((u) => u.user_feedback.some((f) => theme.test.test(f)));
    if (hits.length < threshold) continue;

    created.push(
      await recordLearning(store, workspaceId, {
        category: theme.category,
        observation: theme.observation,
        evidence: [`User feedback on ${hits.map((u) => u.id).join(', ')}`],
        action: theme.action,
        tags: [theme.tag, 'operational-feedback'],
        sourceUnits: hits.map((u) => u.id),
        operationalFeedback: true,
        confidence: 'HIGH',
      }),
    );
  }

  return created;
}

/** Ranks learnings for the context bundle: fresh, confident, on-topic first. */
export function rankLearnings(
  learnings: Learning[],
  opts: { categories?: LearningCategory[]; tags?: string[]; limit?: number } = {},
): Learning[] {
  const confidenceWeight: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const now = Date.now();

  return learnings
    .filter((l) => !l.superseded_by)
    .map((l) => {
      let score = confidenceWeight[l.confidence] * 2;
      if (opts.categories?.includes(l.category)) score += 3;
      if (opts.tags?.some((t) => l.tags.includes(t))) score += 2;
      const ageDays = (now - new Date(l.created_at).getTime()) / 86_400_000;
      score -= Math.min(ageDays / 30, 3); // gently decay, never to zero
      return { l, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 12)
    .map((x) => x.l);
}
