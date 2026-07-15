import { existsSync, readFileSync } from 'fs';
import { pickRandom } from '../utils/anti-detect';
import type { Config } from '../config';

export interface PlaceholderContext {
  sender: string;
  senderName: string;
  senderFull: string;
  group: string;
  time: string;
  emoji: string;
}

const HARDCODED_FALLBACKS = [
  'Good one!',
  'lol',
  'nice',
  'agree',
  'fr',
];

let cachedReplies: string[] | null = null;

export function loadReplies(filePath: string): string[] {
  if (cachedReplies) return cachedReplies;

  if (!existsSync(filePath)) {
    cachedReplies = HARDCODED_FALLBACKS;
    return cachedReplies;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2).trim())
      .filter(Boolean);

    if (lines.length === 0) {
      cachedReplies = HARDCODED_FALLBACKS;
    } else {
      cachedReplies = lines;
    }
  } catch {
    cachedReplies = HARDCODED_FALLBACKS;
  }

  return cachedReplies;
}

export function pickReply(config: Config): string {
  const replies = loadReplies('replies.md');
  return pickRandom(replies);
}

export function resolvePlaceholders(
  template: string,
  ctx: PlaceholderContext,
  emojiPool: string[],
): string {
  return template
    .replace(/\{sender\}/g, ctx.sender)
    .replace(/\{senderName\}/g, ctx.senderName)
    .replace(/\{senderFull\}/g, ctx.senderFull)
    .replace(/\{group\}/g, ctx.group)
    .replace(/\{time\}/g, ctx.time)
    .replace(/\{emoji\}/g, pickRandom(emojiPool));
}

export function getPlaceholderContext(
  senderUsername: string | undefined,
  senderFirstName: string | string | undefined,
  senderLastName: string | undefined,
  groupTitle: string,
  emojiPool: string[],
): PlaceholderContext {
  const username = senderUsername ?? 'unknown';
  const firstName = senderFirstName ?? username;
  const lastName = senderLastName ?? '';
  const sender = senderUsername ? `@${senderUsername}` : firstName;
  const senderFull = lastName ? `${firstName} ${lastName}` : firstName;
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return {
    sender,
    senderName: firstName,
    senderFull,
    group: groupTitle,
    time,
    emoji: pickRandom(emojiPool),
  };
}
