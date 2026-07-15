import OpenAI from 'openai';
import { config } from '../config';
import { logger } from '../utils/logger';
import { pickReply, resolvePlaceholders, type PlaceholderContext } from './replies';

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!config.LLM_API_KEY) return null;
  if (openaiClient) return openaiClient;

  openaiClient = new OpenAI({
    apiKey: config.LLM_API_KEY,
    baseURL: config.LLM_BASE_URL || undefined,
    timeout: config.LLM_TIMEOUT_MS,
  });

  return openaiClient;
}

export interface LlmResult {
  text: string;
  source: 'llm' | 'markdown' | 'fallback';
}

export async function generateReply(
  messageText: string,
  ctx: PlaceholderContext,
): Promise<LlmResult> {
  const client = getClient();

  if (!client) {
    return { text: pickReply(config), source: 'markdown' };
  }

  const useLLM = Math.random() < config.LLM_PROBABILITY;
  if (!useLLM) {
    return { text: pickReply(config), source: 'markdown' };
  }

  const systemPrompt = resolvePlaceholders(config.LLM_SYSTEM_PROMPT, ctx, config.REACT_EMOJIS);
  const userPrompt = `[Group: ${ctx.group}] [Sender: ${ctx.senderName} (@${ctx.sender})]\nMessage: "${messageText}"\n\nWrite a short reply:`;

  try {
    const response = await client.chat.completions.create({
      model: config.LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: config.MAX_REPLY_TOKENS,
      temperature: 0.9,
    });

    const text = response.choices[0]?.message?.content?.trim();
    if (!text) {
      logger.warn('LLM returned empty response, falling back to markdown');
      return { text: pickReply(config), source: 'markdown' };
    }

    logger.info({ source: 'llm', length: text.length }, 'LLM reply generated');
    return { text, source: 'llm' };
  } catch (err: unknown) {
    logger.warn({ err }, 'LLM call failed, falling back to markdown');
    return { text: pickReply(config), source: 'markdown' };
  }
}
