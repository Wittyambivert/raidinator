import Database from 'better-sqlite3';
import { config } from './config';

let db: Database.Database;

export function initDb(): Database.Database {
  db = new Database(config.DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS seen_messages (
      message_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      processed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, chat_id)
    );

    CREATE TABLE IF NOT EXISTS action_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      action_detail TEXT,
      source TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS control_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_titles (
      chat_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS watched_groups (
      chat_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_action_log_timestamp ON action_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_action_log_type_time ON action_log(action_type, timestamp);
    CREATE INDEX IF NOT EXISTS idx_seen_processed ON seen_messages(processed_at);
  `);

  return db;
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function markSeen(messageId: number, chatId: number): void {
  const d = getDb();
  d.prepare(
    'INSERT OR IGNORE INTO seen_messages (message_id, chat_id) VALUES (?, ?)',
  ).run(messageId, chatId);
}

export function isSeen(messageId: number, chatId: number): boolean {
  const d = getDb();
  const row = d.prepare(
    'SELECT 1 FROM seen_messages WHERE message_id = ? AND chat_id = ?',
  ).get(messageId, chatId) as unknown;
  return row !== undefined;
}

export function logAction(
  messageId: number,
  chatId: number,
  actionType: string,
  actionDetail: string | undefined,
  source: string | undefined,
): void {
  const d = getDb();
  d.prepare(
    'INSERT INTO action_log (message_id, chat_id, action_type, action_detail, source) VALUES (?, ?, ?, ?, ?)',
  ).run(messageId, chatId, actionType, actionDetail ?? null, source ?? null);
}

export function countRecentActions(
  actionType: string,
  chatId: number,
  windowMs: number,
): number {
  const d = getDb();
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const row = d.prepare(
    'SELECT COUNT(*) as cnt FROM action_log WHERE action_type = ? AND chat_id = ? AND timestamp >= ?',
  ).get(actionType, chatId, cutoff) as { cnt: number };
  return row.cnt;
}

export function isEmergencyStopped(): boolean {
  const d = getDb();
  const row = d.prepare(
    'SELECT value FROM control_state WHERE key = ?',
  ).get('stopped') as { value: string } | undefined;
  return row?.value === 'true';
}

export function setEmergencyStopped(stopped: boolean): void {
  const d = getDb();
  d.prepare(
    'INSERT OR REPLACE INTO control_state (key, value) VALUES (?, ?)',
  ).run('stopped', stopped ? 'true' : 'false');
}

export function getStartCount(): number {
  const d = getDb();
  const row = d.prepare(
    'SELECT value FROM control_state WHERE key = ?',
  ).get('start_count') as { value: string } | undefined;
  return row ? parseInt(row.value, 10) : 0;
}

export function incrementStartCount(): void {
  const d = getDb();
  const current = getStartCount();
  d.prepare(
    'INSERT OR REPLACE INTO control_state (key, value) VALUES (?, ?)',
  ).run('start_count', String(current + 1));
}

export function resetStartCount(): void {
  const d = getDb();
  d.prepare(
    'INSERT OR REPLACE INTO control_state (key, value) VALUES (?, ?)',
  ).run('start_count', '0');
}

export function getLastStartTime(): string | null {
  const d = getDb();
  const row = d.prepare(
    'SELECT value FROM control_state WHERE key = ?',
  ).get('last_start') as { value: string } | undefined;
  return row?.value ?? null;
}

export function setLastStartTime(): void {
  const d = getDb();
  d.prepare(
    'INSERT OR REPLACE INTO control_state (key, value) VALUES (?, ?)',
  ).run('last_start', new Date().toISOString());
}

export function setCleanShutdown(): void {
  const d = getDb();
  d.prepare(
    'INSERT OR REPLACE INTO control_state (key, value) VALUES (?, ?)',
  ).run('clean_shutdown', new Date().toISOString());
}

export function getCleanShutdown(): string | null {
  const d = getDb();
  const row = d.prepare(
    'SELECT value FROM control_state WHERE key = ?',
  ).get('clean_shutdown') as { value: string } | undefined;
  return row?.value ?? null;
}

export function getGroupLastAction(chatId: number): number | null {
  const d = getDb();
  const row = d.prepare(
    'SELECT timestamp FROM action_log WHERE chat_id = ? ORDER BY timestamp DESC LIMIT 1',
  ).get(chatId) as { timestamp: string } | undefined;
  if (!row) return null;
  return new Date(row.timestamp).getTime();
}

export function purgeOldSeen(maxAgeDays: number): void {
  const d = getDb();
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  d.prepare('DELETE FROM seen_messages WHERE processed_at < ?').run(cutoff);
}

export function getActionCountToday(chatId: number): number {
  const d = getDb();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const row = d.prepare(
    'SELECT COUNT(*) as cnt FROM action_log WHERE chat_id = ? AND timestamp >= ?',
  ).get(chatId, today.toISOString()) as { cnt: number };
  return row.cnt;
}

export function saveGroupTitle(chatId: number, title: string): void {
  const d = getDb();
  d.prepare(
    'INSERT OR REPLACE INTO group_titles (chat_id, title, updated_at) VALUES (?, ?, datetime(\'now\'))',
  ).run(chatId, title);
}

export function getGroupTitle(chatId: number): string | null {
  const d = getDb();
  const row = d.prepare(
    'SELECT title FROM group_titles WHERE chat_id = ?',
  ).get(chatId) as { title: string } | undefined;
  return row?.title ?? null;
}

export function addWatchedGroup(chatId: number, title: string): void {
  const d = getDb();
  d.prepare(
    'INSERT OR REPLACE INTO watched_groups (chat_id, title, added_at) VALUES (?, ?, datetime(\'now\'))',
  ).run(chatId, title);
}

export function getWatchedGroups(): { chatId: number; title: string }[] {
  const d = getDb();
  return d.prepare(
    'SELECT chat_id, title FROM watched_groups',
  ).all() as { chatId: number; title: string }[];
}

export function isWatchedGroup(chatId: number): boolean {
  const d = getDb();
  const row = d.prepare(
    'SELECT 1 FROM watched_groups WHERE chat_id = ?',
  ).get(chatId) as unknown;
  return row !== undefined;
}
