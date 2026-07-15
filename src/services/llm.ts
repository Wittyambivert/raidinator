import OpenAI from 'openai';
import { config } from '../config';
import { logger } from '../utils/logger';
import { pickReply, resolvePlaceholders, type PlaceholderContext } from './replies';
import { buildGuardedSystemPrompt, validateInput, validateOutput, auditLog } from './guardrails';

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

  const inputCheck = validateInput(
    messageText,
    config.LLM_REJECT_INSTRUCTION_OVERRIDE,
    config.LLM_BLOCKED_INPUT_PATTERNS,
  );
  if (!inputCheck.allowed) {
    logger.warn({ reason: inputCheck.reason, text: messageText.slice(0, 100) }, 'LLM input guardrail triggered');
    return { text: pickReply(config), source: 'markdown' };
  }

  const systemPrompt = buildGuardedSystemPrompt(
    resolvePlaceholders(config.LLM_SYSTEM_PROMPT, ctx, config.REACT_EMOJIS),
  );
  const userPrompt = `[Group: ${ctx.group}] [Sender: ${ctx.senderName} (@${ctx.sender})]\nMessage: "${messageText}"\n\nWrite a short reply:`;

  try {
    const response = await client.chat.completions.create({
      model: config.LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: config.MAX_REPLY_TOKENS,
      temperature: config.LLM_TEMPERATURE,
    });

    const text = response.choices[0]?.message?.content?.trim();
    if (!text) {
      logger.warn('LLM returned empty response, falling back to markdown');
      return { text: pickReply(config), source: 'markdown' };
    }

    const outputCheck = validateOutput(
      text,
      config.LLM_BLOCKED_OUTPUT_PATTERNS,
      config.LLM_HALLUCINATION_MARKERS,
      config.LLM_PII_FILTER,
    );
    if (!outputCheck.allowed) {
      logger.warn({ reason: outputCheck.reason, text: text.slice(0, 100) }, 'LLM output guardrail triggered');
      return { text: pickReply(config), source: 'markdown' };
    }

    if (config.LLM_AUDIT_LOG) {
      auditLog(systemPrompt, userPrompt, text);
    }

    logger.info({ source: 'llm', length: text.length }, 'LLM reply generated');
    return { text, source: 'llm' };
  } catch (err: unknown) {
    logger.warn({ err }, 'LLM call failed, falling back to markdown');
    return { text: pickReply(config), source: 'markdown' };
  }
}
