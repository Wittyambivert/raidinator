import { existsSync, readFileSync } from 'fs';
import { logger } from '../utils/logger';
import { getDb, getStartCount, getLastStartTime, incrementStartCount, setLastStartTime, resetStartCount } from '../db';
import { config } from '../config';

export function checkCrashLoop(): boolean {
  if (wasCleanShutdown()) {
    resetStartCount();
    return false;
  }

  const startCount = getStartCount();
  const lastStart = getLastStartTime();

  if (lastStart) {
    const last = new Date(lastStart).getTime();
    const oneHour = 3_600_000;
    const startsWithinHour = (Date.now() - last) < oneHour;

    if (startsWithinHour && startCount > config.MAX_RESTARTS_PER_HOUR) {
      logger.fatal({ startCount, lastStart }, 'Crash loop detected — too many restarts');
      return true;
    }
  }

  incrementStartCount();
  setLastStartTime();
  return false;
}

function wasCleanShutdown(): boolean {
  const d = getDb();
  const row = d.prepare(
    'SELECT value FROM control_state WHERE key = ?',
  ).get('clean_shutdown') as { value: string } | undefined;
  if (!row) return false;

  const shutdownTime = new Date(row.value).getTime();
  const lastStart = getLastStartTime();
  if (!lastStart) return false;

  const lastStartTime = new Date(lastStart).getTime();
  return shutdownTime > lastStartTime;
}

export function logHeartbeat(): void {
  const db = getDb();
  const totalActionsToday = db.prepare(
    'SELECT COUNT(*) as cnt FROM action_log WHERE timestamp >= date(\'now\')'
  ).get() as { cnt: number };

  logger.info({
    uptime: process.uptime(),
    actionsToday: totalActionsToday.cnt,
    groupsWatching: config.TARGET_GROUPS.length,
  }, 'Heartbeat');
}

export function loadLastStartFile(): string | null {
  const path = './logs/last_start.txt';
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf-8').trim();
  } catch {
    return null;
  }
}
