import type { TelegramClient } from 'telegram';
import type { CustomMessage } from 'telegram/tl/custom/message';
import { config } from '../config';
import { logger } from '../utils/logger';
import { isEmergencyStopped, setEmergencyStopped, getActionCountToday } from '../db';

export async function handleCommand(
  client: TelegramClient,
  message: CustomMessage,
): Promise<boolean> {
  if (!config.EMERGENCY_STOP_ENABLED) return false;
  if (!message.isPrivate) return false;

  const text = (message.text ?? '').trim().toLowerCase();
  if (!text.startsWith('/')) return false;

  const sender = await message.getSender();
  const senderUser = sender as { username?: string } | null;
  const username = senderUser?.username;
  if (username !== config.ADMIN_USERNAME) {
    logger.warn({ username, adminRequired: config.ADMIN_USERNAME, command: text }, 'Unauthorized command attempt');
    return false;
  }

  if (text === '/stop') {
    setEmergencyStopped(true);
    await message.reply({ message: 'Raidinator stopped. All outbound actions disabled.' });
    logger.info('Emergency stop activated by admin');
    return true;
  }

  if (text === '/start') {
    setEmergencyStopped(false);
    await message.reply({ message: 'Raidinator started. Actions enabled.' });
    logger.info('Raidinator re-enabled by admin');
    return true;
  }

  if (text === '/status') {
    const stopped = isEmergencyStopped();
    const uptime = Math.round(process.uptime());
    const actions = config.TARGET_GROUPS.map((g) => {
      const count = getActionCountToday(0);
      return `  ${g}: ${count} actions today`;
    }).join('\n');
    await message.reply({
      message: `Status: ${stopped ? 'STOPPED' : 'RUNNING'}\nUptime: ${uptime}s\nGroups:\n${actions}`,
    });
    return true;
  }

  if (text === '/schedule') {
    await message.reply({ message: 'Schedule not configured. (Feature planned for future update.)' });
    return true;
  }

  if (text === '/config') {
    const info = [
      `Keywords: ${config.KEYWORDS.join(', ') || '(none)'}`,
      `Target users: ${config.TARGET_USERS.join(', ') || '(all)'}`,
      `Max actions/hour: ${config.MAX_ACTIONS_PER_HOUR}`,
      `Skip probability: ${config.SKIP_PROBABILITY}`,
      `LLM: ${config.LLM_API_KEY ? `${config.LLM_PROVIDER || 'custom'} (${config.LLM_MODEL})` : 'disabled'}`,
      `Dry run: ${config.DRY_RUN}`,
    ].join('\n');
    await message.reply({ message: info });
    return true;
  }

  return false;
}
