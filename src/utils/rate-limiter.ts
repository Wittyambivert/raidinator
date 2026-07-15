import type Database from 'better-sqlite3';
import { countRecentActions } from '../db';

export class RateLimiter {
  private db: Database.Database;
  private maxPerWindow: number;
  private windowMs: number;

  constructor(db: Database.Database, maxPerHour: number) {
    this.db = db;
    this.maxPerWindow = maxPerHour;
    this.windowMs = 3_600_000;
  }

  canAct(chatId: number): boolean {
    const recent = countRecentActions('react', chatId, this.windowMs)
      + countRecentActions('reply', chatId, this.windowMs)
      + countRecentActions('click', chatId, this.windowMs);
    return recent < this.maxPerWindow;
  }

  remaining(chatId: number): number {
    const recent = countRecentActions('react', chatId, this.windowMs)
      + countRecentActions('reply', chatId, this.windowMs)
      + countRecentActions('click', chatId, this.windowMs);
    return Math.max(0, this.maxPerWindow - recent);
  }

  static forGroup(
    db: Database.Database,
    maxPerHour: number,
    multiplier: number,
  ): RateLimiter {
    const scaled = Math.max(1, Math.round(maxPerHour * multiplier));
    return new RateLimiter(db, scaled);
  }
}
