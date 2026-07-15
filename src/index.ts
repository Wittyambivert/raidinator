import { config } from './config';
import { logger } from './utils/logger';
import { initDb, getDb, purgeOldSeen, resetStartCount, setCleanShutdown } from './db';
import { createClient } from './client';
import { registerMessageHandler } from './handlers/message';
import { checkCrashLoop, logHeartbeat } from './utils/health';
import { mkdirSync } from 'fs';

async function main(): Promise<void> {
  logger.info('Raidinator starting...');

  mkdirSync(config.SESSIONS_DIR, { recursive: true });
  mkdirSync(config.SESSION_ENCRYPTED_DIR, { recursive: true });
  mkdirSync('./logs', { recursive: true });

  initDb();

  if (checkCrashLoop()) {
    logger.fatal('Crash loop detected — exiting');
    process.exit(1);
  }

  const client = await createClient();

  registerMessageHandler(client);

  logger.info(
    {
      groups: config.TARGET_GROUPS,
      keywords: config.KEYWORDS,
      llm: config.LLM_API_KEY
        ? `${config.LLM_PROVIDER || 'custom'} (${config.LLM_MODEL})`
        : 'disabled',
      dryRun: config.DRY_RUN,
    },
    'Raidinator online',
  );

  if (!config.DRY_RUN && config.TARGET_GROUPS.length === 0) {
    logger.warn('No TARGET_GROUPS configured — bot will not process any messages');
  }

  const heartbeatInterval = setInterval(
    () => {
      logHeartbeat();
    },
    config.HEARTBEAT_INTERVAL_MINUTES * 60 * 1000,
  );

  const cleanupInterval = setInterval(
    () => {
      try {
        purgeOldSeen(config.LOG_RETENTION_DAYS);
      } catch (err: unknown) {
        logger.error({ err }, 'Failed to purge old seen messages');
      }
    },
    6 * 60 * 60 * 1000,
  );

  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    clearInterval(heartbeatInterval);
    clearInterval(cleanupInterval);
    try {
      await client.disconnect();
    } catch (err: unknown) {
      logger.error({ err }, 'Error during disconnect');
    }
    setCleanShutdown();
    resetStartCount();
    try {
      getDb().close();
    } catch (err: unknown) {
      logger.error({ err }, 'Error closing database');
    }
    logger.info('Raidinator stopped');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM');
    process.emit('SIGINT' as unknown as string, 'SIGTERM');
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (err: Error) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
