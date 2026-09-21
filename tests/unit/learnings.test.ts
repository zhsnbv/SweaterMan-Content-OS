import { describe, expect, it } from 'vitest';
import { confidenceForEvidence, rankLearnings } from '@/lib/services/learnings';
import type { Learning } from '@/lib/domain/schema';

const learning = (over: Partial<Learning>): Learning => ({
  id: 'l1',
  workspace_id: 'ws',
  created_at: new Date().toISOString(),
  category: 'content',
  observation: 'o',
  evidence: ['e'],
  confidence: 'LOW',
  action: '',
  tags: [],
  source_units: [],
  superseded_by: null,
  ...over,
});

describe('evidence → confidence', () => {
  it('treats a single data point as LOW', () => {
    expect(confidenceForEvidence(1)).toBe('LOW');
    expect(confidenceForEvidence(1, { repeatedPattern: true })).toBe('LOW');
  });

  it('allows MEDIUM once results are comparable', () => {
    expect(confidenceForEvidence(2)).toBe('MEDIUM');
    expect(confidenceForEvidence(3)).toBe('MEDIUM');
  });

  it('reaches HIGH only for a repeated pattern or repeated team feedback', () => {
    expect(confidenceForEvidence(4, { repeatedPattern: true })).toBe('HIGH');
    expect(confidenceForEvidence(3, { operationalFeedback: true })).toBe('HIGH');
    expect(confidenceForEvidence(3, { repeatedPattern: true })).toBe('MEDIUM');
  });
});

describe('ranking for the context bundle', () => {
  it('prefers confident, on-topic learnings and hides superseded ones', () => {
    const ranked = rankLearnings(
      [
        learning({ id: 'low', confidence: 'LOW', category: 'audience' }),
        learning({ id: 'high', confidence: 'HIGH', category: 'production' }),
        learning({ id: 'dead', confidence: 'HIGH', superseded_by: 'high' }),
      ],
      { categories: ['production'], limit: 10 },
    );
    expect(ranked.map((l) => l.id)).toEqual(['high', 'low']);
  });

  it('respects the limit so the bundle stays bounded', () => {
    const many = Array.from({ length: 40 }, (_, i) => learning({ id: `l${i}` }));
    expect(rankLearnings(many, { limit: 6 })).toHaveLength(6);
  });
});
