import { errors } from 'telegram';
import type { Logger } from 'pino';

export async function withFloodWait<T>(
  fn: () => Promise<T>,
  logger: Logger,
): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    if (err instanceof errors.FloodWaitError) {
      logger.warn({ seconds: err.seconds }, 'FloodWait triggered — sleeping');
      await sleep(err.seconds * 1000);
      return await fn();
    }
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
