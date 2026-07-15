import { Api, TelegramClient } from 'telegram';
import type { CustomMessage } from 'telegram/tl/custom/message';
import { config } from '../config';
import type { GroupConfig } from '../config';
import { logger } from '../utils/logger';
import { withFloodWait } from '../utils/flood-wait';
import { pickRandom } from '../utils/anti-detect';
import { logAction } from '../db';
import { generateReply } from '../services/llm';
import type { PlaceholderContext } from '../services/replies';

export interface DispatchResult {
  react: { success: boolean; emoji?: string; error?: string };
  reply: { success: boolean; text?: string; source?: string; error?: string };
  click: { success: boolean; error?: string };
}

export async function react(
  client: TelegramClient,
  message: CustomMessage,
  groupConfig: GroupConfig,
): Promise<{ success: boolean; emoji?: string; error?: string }> {
  const emoji = pickRandom(config.REACT_EMOJIS);
  const reactions: Api.TypeReaction[] = [
    new Api.ReactionEmoji({ emoticon: emoji }),
  ];

  if (Math.random() < config.REACT_DOUBLE_PROBABILITY && config.REACT_EMOJIS.length > 1) {
    const secondEmoji = pickRandom(config.REACT_EMOJIS.filter((e) => e !== emoji));
    reactions.push(new Api.ReactionEmoji({ emoticon: secondEmoji }));
  }

  try {
    await withFloodWait(
      () => client.invoke(
        new Api.messages.SendReaction({
          peer: message.chatId!,
          msgId: message.id,
          reaction: reactions,
        }),
      ),
      logger,
    );

    const chatId = message.chatId ? Number(message.chatId.toString()) : 0;
    logAction(message.id, chatId, 'react', emoji, undefined);
    logger.info({ action: 'react', messageId: message.id, emoji }, 'React sent ✓');
    return { success: true, emoji };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ action: 'react', err: msg, messageId: message.id }, 'React failed ✗');
    return { success: false, emoji, error: msg };
  }
}

export async function reply(
  client: TelegramClient,
  message: CustomMessage,
  groupConfig: GroupConfig,
  groupTitle: string,
  ctx: PlaceholderContext,
): Promise<{ success: boolean; text?: string; source?: string; error?: string }> {
  const result = await generateReply(message.text ?? '', ctx);

  try {
    if (config.TYPING_INDICATOR_MS > 0) {
      await withFloodWait(
        () => client.invoke(
          new Api.messages.SetTyping({
            peer: message.chatId!,
            action: new Api.SendMessageTypingAction(),
          }),
        ),
        logger,
      );
      await new Promise((resolve) => setTimeout(resolve, config.TYPING_INDICATOR_MS));
    }

    await withFloodWait(
      () => client.sendMessage(message.chatId!, {
        message: result.text,
        replyTo: message.id,
      }),
      logger,
    );

    const chatId = message.chatId ? Number(message.chatId.toString()) : 0;
    logAction(message.id, chatId, 'reply', result.text, result.source);
    logger.info({ action: 'reply', messageId: message.id, text: result.text, source: result.source }, 'Reply sent ✓');
    return { success: true, text: result.text, source: result.source };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ action: 'reply', err: msg, messageId: message.id }, 'Reply failed ✗');
    return { success: false, text: result.text, source: result.source, error: msg };
  }
}

export async function clickInlineButton(
  client: TelegramClient,
  message: CustomMessage,
): Promise<{ success: boolean; error?: string }> {
  try {
    const markup = message.replyMarkup as { rows?: { buttons?: { data?: Buffer; text?: string }[] }[] } | null;
    if (!markup?.rows) {
      logger.info({ action: 'click', messageId: message.id }, 'Click skipped — no buttons');
      return { success: false, error: 'no buttons' };
    }

    const buttons = markup.rows.flatMap((r) => r.buttons ?? []).filter((b) => b.data);
    if (buttons.length === 0) {
      logger.info({ action: 'click', messageId: message.id }, 'Click skipped — no actionable buttons');
      return { success: false, error: 'no actionable buttons' };
    }

    const button = buttons[Math.floor(Math.random() * buttons.length)]!;

    await withFloodWait(
      () => client.invoke(
        new Api.messages.GetBotCallbackAnswer({
          peer: message.chatId!,
          msgId: message.id,
          data: button.data!,
        }),
      ),
      logger,
    );

    const chatId = message.chatId ? Number(message.chatId.toString()) : 0;
    logAction(message.id, chatId, 'click', button.text, undefined);
    logger.info({ action: 'click', messageId: message.id, button: button.text }, 'Click sent ✓');
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ action: 'click', err: msg, messageId: message.id }, 'Click failed ✗');
    return { success: false, error: msg };
  }
}

export async function dispatchActions(
  client: TelegramClient,
  message: CustomMessage,
  groupConfig: GroupConfig,
  groupTitle: string,
  ctx: PlaceholderContext,
): Promise<DispatchResult> {
  const result: DispatchResult = {
    react: { success: false },
    reply: { success: false },
    click: { success: false },
  };

  result.react = await react(client, message, groupConfig);

  result.reply = await reply(client, message, groupConfig, groupTitle, ctx);

  const hasButtons = !!(message.replyMarkup as { rows?: unknown } | null)?.rows;
  if (hasButtons) {
    result.click = await clickInlineButton(client, message);
  } else {
    logger.info({ action: 'click', messageId: message.id }, 'Click skipped — no replyMarkup');
  }

  logger.info({
    messageId: message.id,
    react: result.react.success ? `✓ ${result.react.emoji ?? ''}` : '✗',
    reply: result.reply.success ? `✓ ${result.reply.text?.slice(0, 40) ?? ''}` : `✗ ${result.reply.error ?? ''}`,
    click: result.click.success ? '✓' : result.click.error ? `✗ ${result.click.error}` : '—',
  }, 'Dispatch complete');

  return result;
}
