import type { MetricValue } from '@/lib/domain/schema';
import type { ToolContext, ToolDef } from './tools';

export type AgentRequest = {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools: ToolDef[];
  ctx: ToolContext;
  role: 'planner' | 'review';
};

export type AgentResponse = {
  text: string;
  toolCalls: Array<{ name: string; summary: string }>;
};

export type VisionRequest = {
  images: Array<{ data: Buffer; contentType: string }>;
  platform: string;
  window: string;
};

export interface AiProvider {
  readonly name: string;
  readonly live: boolean;
  run(req: AgentRequest): Promise<AgentResponse>;
  extractMetrics(req: VisionRequest): Promise<{ metrics: MetricValue[]; note: string }>;
}
