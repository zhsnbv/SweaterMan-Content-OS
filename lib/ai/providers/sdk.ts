import { generateText, stepCountIs, tool, type ToolSet } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { env } from '@/lib/env';
import type { AiConfig } from '../config';
import type { AgentRequest, AgentResponse, AiProvider, VisionRequest } from '../provider';
import { VISION_SYSTEM } from '../prompts';
import { sanitizeMetrics } from '@/lib/services/analytics';

/**
 * Thin adapter over the Vercel AI SDK. The provider is chosen from config, so
 * business logic never mentions a model name — see lib/ai/config.ts.
 */
export class SdkProvider implements AiProvider {
  readonly live = true;
  readonly name: string;

  constructor(private readonly config: AiConfig) {
    this.name = config.provider;
  }

  private model(role: 'planner' | 'review' | 'vision') {
    const id = this.config.models[role];
    if (this.config.provider === 'openai') {
      return createOpenAI({ apiKey: env.openaiKey })(id);
    }
    return createAnthropic({ apiKey: env.anthropicKey })(id);
  }

  async run(req: AgentRequest): Promise<AgentResponse> {
    const tools: ToolSet = Object.fromEntries(
      req.tools.map((t) => [
        t.name,
        tool({
          description: t.description,
          inputSchema: t.inputSchema as never,
          execute: async (input: unknown) => {
            try {
              return await t.execute(req.ctx, input as never);
            } catch (err) {
              // Surface the failure to the model so it can correct itself
              // instead of silently reporting success to the user.
              return { error: err instanceof Error ? err.message : String(err) };
            }
          },
        }),
      ]),
    );

    const result = await generateText({
      model: this.model(req.role),
      system: req.system,
      messages: req.messages,
      tools,
      stopWhen: stepCountIs(12),
    });

    return { text: result.text.trim(), toolCalls: req.ctx.calls };
  }

  async extractMetrics(req: VisionRequest) {
    const schema = z.object({
      metrics: z.array(
        z.object({
          key: z.string(),
          value: z.number().nullable(),
          raw: z.string().default(''),
        }),
      ),
    });

    const result = await generateText({
      model: this.model('vision'),
      system: VISION_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text' as const,
              text: `Платформа: ${req.platform}. Окно отчёта: ${req.window}. Извлеки только видимые метрики. Верни JSON.`,
            },
            ...req.images.map((img) => ({
              type: 'image' as const,
              image: img.data,
              mediaType: img.contentType,
            })),
          ],
        },
      ],
    });

    try {
      const jsonText = result.text.slice(
        result.text.indexOf('{'),
        result.text.lastIndexOf('}') + 1,
      );
      const parsed = schema.parse(JSON.parse(jsonText));
      return {
        metrics: sanitizeMetrics(parsed.metrics),
        note: 'Извлечено моделью со зрением. Проверьте цифры перед сохранением.',
      };
    } catch {
      return {
        metrics: [],
        note: 'Не удалось разобрать ответ модели. Введите метрики вручную.',
      };
    }
  }
}
