import { mkdir } from "node:fs/promises";
import Database from "better-sqlite3";
import { randomInt } from "node:crypto";
import { DATA_DIR, DB_PATH } from "../utils/paths.js";
import type { ChannelName, MessageRecord, SessionRecord } from "../types.js";

export class Store {
  private readonly db: Database.Database;

  private constructor(db: Database.Database) {
    this.db = db;
    this.migrate();
  }

  static async open(): Promise<Store> {
    await mkdir(DATA_DIR, { recursive: true });
    const db = new Database(DB_PATH);
    return new Store(db);
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(channel, sender_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        direction TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS pairings (
        channel TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        approved INTEGER NOT NULL DEFAULT 0,
        code TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(channel, sender_id)
      );

      CREATE TABLE IF NOT EXISTS memory_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  private now(): string {
    return new Date().toISOString();
  }

  private generatePairingCode(): string {
    return `${randomInt(100000, 999999)}`;
  }

  private safeCount(sql: string): number {
    try {
      const row = this.db.prepare(sql).get() as { count: number } | undefined;
      return row?.count ?? 0;
    } catch {
      return 0;
    }
  }

  private safeOne<T>(fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch {
      return fallback;
    }
  }

  upsertPairing(channel: ChannelName, senderId: string) {
    const existing = this.db
      .prepare("SELECT approved, code FROM pairings WHERE channel = ? AND sender_id = ?")
      .get(channel, senderId) as { approved: number; code: string } | undefined;

    if (existing) {
      return {
        approved: existing.approved === 1,
        code: existing.code
      };
    }

    const code = this.generatePairingCode();
    this.db
      .prepare(
        "INSERT INTO pairings(channel, sender_id, approved, code, created_at) VALUES (?, ?, 0, ?, ?)"
      )
      .run(channel, senderId, code, this.now());
    return { approved: false, code };
  }

  approvePairing(channel: ChannelName, code: string): boolean {
    const result = this.db
      .prepare("UPDATE pairings SET approved = 1 WHERE channel = ? AND code = ?")
      .run(channel, code);
    return result.changes > 0;
  }

  getOrCreateSession(channel: ChannelName, senderId: string): number {
    const now = this.now();
    const insert = this.db
      .prepare(
        "INSERT OR IGNORE INTO sessions(channel, sender_id, created_at, updated_at) VALUES (?, ?, ?, ?)"
      )
      .run(channel, senderId, now, now);

    if (insert.changes > 0) {
      return Number(insert.lastInsertRowid);
    }

    this.db
      .prepare("UPDATE sessions SET updated_at = ? WHERE channel = ? AND sender_id = ?")
      .run(now, channel, senderId);
    const row = this.db
      .prepare("SELECT id FROM sessions WHERE channel = ? AND sender_id = ?")
      .get(channel, senderId) as { id: number } | undefined;
    if (!row) {
      throw new Error("Failed to resolve session");
    }
    return row.id;
  }

  addMessage(sessionId: number, direction: "inbound" | "outbound", content: string): number {
    const result = this.db
      .prepare("INSERT INTO messages(session_id, direction, content, created_at) VALUES (?, ?, ?, ?)")
      .run(sessionId, direction, content, this.now());
    return Number(result.lastInsertRowid);
  }

  getRecentMessages(sessionId: number, limit = 20): MessageRecord[] {
    return this.db
      .prepare(
        "SELECT id, session_id as sessionId, direction, content, created_at as createdAt FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?"
      )
      .all(sessionId, limit)
      .reverse() as unknown as MessageRecord[];
  }

  listSessions(limit = 100): SessionRecord[] {
    return this.db
      .prepare(
        "SELECT id, channel, sender_id as senderId, created_at as createdAt, updated_at as updatedAt FROM sessions ORDER BY updated_at DESC LIMIT ?"
      )
      .all(limit) as unknown as SessionRecord[];
  }

  getOverviewStats() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      );
    `);

    const sessions = this.safeCount("SELECT COUNT(*) as count FROM sessions");
    const messages = this.safeCount("SELECT COUNT(*) as count FROM messages");
    const pairingsApproved = this.safeCount(
      "SELECT COUNT(*) as count FROM pairings WHERE approved = 1"
    );
    const pairingsPending = this.safeCount(
      "SELECT COUNT(*) as count FROM pairings WHERE approved = 0"
    );
    const byChannel = this.safeOne(
      () =>
        this.db.prepare(
          "SELECT channel, COUNT(*) as count FROM sessions GROUP BY channel ORDER BY count DESC"
        ).all() as Array<{ channel: string; count: number }>,
      []
    );

    const memorySaved = this.safeCount(
      "SELECT COUNT(*) as count FROM memory_events WHERE status = 'saved'"
    );
    const memoryFailed = this.safeCount(
      "SELECT COUNT(*) as count FROM memory_events WHERE status = 'failed'"
    );
    const lastMemorySaved = this.safeOne(
      () =>
        this.db
          .prepare(
            "SELECT created_at as createdAt FROM memory_events WHERE status = 'saved' ORDER BY id DESC LIMIT 1"
          )
          .get() as { createdAt: string } | undefined,
      undefined
    );
    const lastMemoryEvent = this.safeOne(
      () =>
        this.db
          .prepare(
            "SELECT status, detail, created_at as createdAt FROM memory_events ORDER BY id DESC LIMIT 1"
          )
          .get() as { status: string; detail: string | null; createdAt: string } | undefined,
      undefined
    );

    return {
      sessions,
      messages,
      pairingsApproved,
      pairingsPending,
      memorySaved,
      memoryFailed,
      lastMemorySavedAt: lastMemorySaved?.createdAt ?? null,
      lastMemoryEvent: lastMemoryEvent ?? null,
      byChannel
    };
  }

  addMemoryEvent(sessionKey: string, status: "saved" | "failed", detail?: string): void {
    this.db
      .prepare(
        "INSERT INTO memory_events(session_key, status, detail, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(sessionKey, status, detail ?? null, this.now());
  }
}
