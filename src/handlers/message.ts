import { NewMessage } from 'telegram/events/index';
import { TelegramClient, errors } from 'telegram';
import type { CustomMessage } from 'telegram/tl/custom/message';
import { config, type GroupConfig } from '../config';
import { logger } from '../utils/logger';
import { isSeen, markSeen, isEmergencyStopped, getGroupLastAction, saveGroupTitle, getGroupTitle, addWatchedGroup, isWatchedGroup } from '../db';
import { shouldSkip, humanDelay } from '../utils/anti-detect';
import { RateLimiter } from '../utils/rate-limiter';
import { dispatchActions } from './actions';
import { handleCommand } from './commands';
import { getPlaceholderContext } from '../services/replies';

const rateLimiters = new Map<string, RateLimiter>();

function getLimiter(chatId: number, groupConfig: GroupConfig): RateLimiter {
  const key = `${chatId}`;
  let limiter = rateLimiters.get(key);
  if (!limiter) {
    const { getDb } = require('../db');
    limiter = RateLimiter.forGroup(
      getDb(),
      groupConfig.maxActionsPerHour,
      1,
    );
    rateLimiters.set(key, limiter);
  }
  return limiter;
}

function getGroupConfig(chatTitle: string, chatId: number): GroupConfig | null {
  const override = config.groupConfigs.get(chatTitle);
  if (override) return override;

  if (isWatchedGroup(chatId)) {
    const cached = getGroupTitle(chatId);
    return {
      name: cached ?? String(chatId),
      keywords: config.KEYWORDS,
      targetUsers: config.TARGET_USERS,
      skipProbability: config.SKIP_PROBABILITY,
      maxActionsPerHour: config.MAX_ACTIONS_PER_HOUR,
    };
  }

  const idStr = String(chatId);
  const canonical = config.TARGET_GROUPS
    .find((g) => g.toLowerCase() === chatTitle.toLowerCase() || g === idStr);
  if (!canonical) return null;

  return {
    name: chatTitle === 'unknown' ? canonical : chatTitle,
    keywords: config.KEYWORDS,
    targetUsers: config.TARGET_USERS,
    skipProbability: config.SKIP_PROBABILITY,
    maxActionsPerHour: config.MAX_ACTIONS_PER_HOUR,
  };
}

function matchesKeyword(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;

  const lower = text.toLowerCase();
  for (const keyword of keywords) {
    const kw = keyword.toLowerCase().trim();
    if (!kw) continue;

    if (kw.includes(' ')) {
      if (lower.includes(kw)) return true;
    } else {
      const words = lower.split(/\s+/);
      if (words.some((w) => {
        const clean = w.replace(/[^a-z0-9]/g, '');
        return clean === kw || clean.includes(kw);
      })) return true;
    }
  }

  return false;
}

function hasTooManyReactions(message: CustomMessage): boolean {
  if (!message.reactions) return false;

  const reactions = message.reactions as {
    results?: { count?: number }[];
  };

  const total = (reactions.results ?? []).reduce(
    (sum, r) => sum + (r.count ?? 0),
    0,
  );

  return total > config.MAX_EXISTING_REACTIONS;
}

function extractText(message: CustomMessage): string | null {
  if (message.text && message.text.trim()) return message.text;

  if (message.media && config.REACT_TO_MEDIA) {
    const media = message.media as { caption?: string };
    if (media.caption) return media.caption;
  }

  return null;
}

function isTargetGroup(chatTitle: string, chatId: number): boolean {
  if (isWatchedGroup(chatId)) return true;

  const idStr = String(chatId);
  return config.TARGET_GROUPS.some(
    (g) => g.toLowerCase() === chatTitle.toLowerCase() || g === idStr,
  );
}

async function getChatTitle(message: CustomMessage): Promise<string> {
  const chatId = message.chatId ? Number(message.chatId.toString()) : 0;

  const cached = getGroupTitle(chatId);
  if (cached) return cached;

  const chat = message.chat as { title?: string; username?: string } | undefined;
  if (chat?.title) {
    saveGroupTitle(chatId, chat.title);
    return chat.title;
  }
  if (chat?.username) {
    saveGroupTitle(chatId, chat.username);
    return chat.username;
  }

  try {
    const entity = await message.getChat();
    if (entity) {
      const e = entity as { title?: string; username?: string };
      const resolved = e.title ?? e.username ?? null;
      if (resolved) {
        saveGroupTitle(chatId, resolved);
        return resolved;
      }
    }
  } catch { }

  return 'unknown';
}

type SenderInfo = { username?: string; firstName?: string; lastName?: string; display: string };

async function getSenderInfo(message: CustomMessage): Promise<SenderInfo> {
  try {
    const entity = await message.getSender();
    if (entity) {
      const e = entity as { username?: string; firstName?: string; lastName?: string };
      const username = e.username;
      const firstName = e.firstName;
      const lastName = e.lastName;
      const display = username
        ? `@${username}`
        : [firstName, lastName].filter(Boolean).join(' ') || 'unknown';
      return { username, firstName, lastName, display };
    }
  } catch { }

  return { display: 'unknown' };
}

async function processMessage(
  client: TelegramClient,
  message: CustomMessage,
): Promise<void> {
  let chatTitle = 'unknown';
  try {
    chatTitle = await getChatTitle(message);
    const chatId = message.chatId ? Number(message.chatId.toString()) : 0;
    const sender = await getSenderInfo(message);
    const rawText = message.text ?? '';

    logger.info({ chat: chatTitle, sender: sender.display, text: rawText.slice(0, 100) }, 'Message');

    if (message.isPrivate) {
      await handleCommand(client, message);
      return;
    }

    if (message.out) return;

    const text = extractText(message);
    if (!text) {
      logger.info({ chat: chatTitle, hasMedia: !!message.media }, 'Skipped — no text');
      return;
    }

    const lowerText = (rawText ?? '').trim().toLowerCase();
    if (lowerText === '/watch') {
      if (sender.username && sender.username.toLowerCase() === config.ADMIN_USERNAME.toLowerCase()) {
        const resolvedTitle = chatTitle !== 'unknown' ? chatTitle : String(chatId);
        addWatchedGroup(chatId, resolvedTitle);
        saveGroupTitle(chatId, resolvedTitle);
        logger.info({ chat: resolvedTitle, id: chatId, sender: sender.display }, 'Group manually watched via /watch');
        try {
          await client.sendMessage(message.chatId!, { message: `Watching: ${resolvedTitle}`, replyTo: message.id });
        } catch { }
        return;
      }
    }

    const keywords = config.KEYWORDS;
    const isAdmin = sender.username && sender.username.toLowerCase() === config.ADMIN_USERNAME.toLowerCase();

    if (matchesKeyword(text, keywords)) {
      if (!isTargetGroup(chatTitle, chatId)) {
        if (isAdmin) {
          addWatchedGroup(chatId, chatTitle !== 'unknown' ? chatTitle : String(chatId));
          logger.info({ chat: chatTitle, id: chatId, sender: sender.display }, 'Group auto-watched by admin keyword');
        } else {
          logger.info({ sender: sender.username, admin: config.ADMIN_USERNAME, text: text.slice(0, 40) }, 'Keyword detected but sender is not admin — group not auto-watched');
        }
      }
    }

    if (!isTargetGroup(chatTitle, chatId)) {
      logger.info({ chat: chatTitle, id: chatId, targets: config.TARGET_GROUPS }, 'Skipped — not target group');
      return;
    }

    if (isSeen(message.id, chatId)) return;

    const groupConfig = getGroupConfig(chatTitle, chatId);
    if (!groupConfig) {
      logger.info({ chat: chatTitle }, 'Skipped — no config');
      return;
    }

    if (!matchesKeyword(text, groupConfig.keywords)) {
      logger.info({ text: text.slice(0, 80), kw: groupConfig.keywords }, 'Skipped — no keyword');
      return;
    }

    if (hasTooManyReactions(message)) {
      logger.info('Skipped — too many reactions');
      return;
    }

    if (shouldSkip(groupConfig.skipProbability)) {
      logger.info({ skipProbability: groupConfig.skipProbability }, 'Skipped — random');
      return;
    }

    const lastAction = getGroupLastAction(chatId);
    if (lastAction) {
      const elapsed = (Date.now() - lastAction) / 1000;
      if (elapsed < config.COOLDOWN_BETWEEN_ACTIONS_S) return;
    }

    const limiter = getLimiter(chatId, groupConfig);
    if (!limiter.canAct(chatId)) {
      logger.info('Skipped — rate limited');
      return;
    }

    if (config.EMERGENCY_STOP_ENABLED && isEmergencyStopped()) {
      logger.info('Skipped — emergency stopped');
      return;
    }

    markSeen(message.id, chatId);

    logger.info({ chat: chatTitle, sender: sender.display, kw: text.slice(0, 80) }, 'Triggered! Dispatching');

    const scaledMin = Math.round(config.MIN_DELAY);
    const scaledMax = Math.round(config.MAX_DELAY);
    await humanDelay(Math.min(scaledMin, 1), Math.min(scaledMax, 300));

    const ctx = getPlaceholderContext(
      sender.username,
      sender.firstName,
      sender.lastName,
      chatTitle,
      config.REACT_EMOJIS,
    );

    await dispatchActions(client, message, groupConfig, chatTitle, ctx);
  } catch (err: unknown) {
    if (err instanceof errors.RPCError) {
      const msg = err.message.toLowerCase();
      if (msg.includes('chat_forbidden') || msg.includes('channel_private')) {
        logger.warn({ chatTitle, error: err.message }, 'Chat access lost');
        return;
      }
    }
    logger.error({ err, messageId: message.id }, 'Error processing message');
  }
}

export function registerMessageHandler(client: TelegramClient): void {
  client.addEventHandler(
    (event: { message: CustomMessage }) => processMessage(client, event.message),
    new NewMessage({}),
  );
  logger.info('Message handler registered');
}
