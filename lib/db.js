// SQLite 数据访问层（node:sqlite 内建，零依赖）。
// 约束：DB 文件必须在 ~/persistent/gamering/data（持久化，不进 git）；开 WAL。
// Postgres 可切换：所有 SQL 只用标准语法；需要并发抢席时把 transaction() 内
// 的读写换成 Postgres 事务 + SELECT ... FOR UPDATE，函数签名不变。

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  discord_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  avatar_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  creator_discord_id TEXT NOT NULL,
  game_text TEXT NOT NULL,
  game_id TEXT,
  start_at INTEGER NOT NULL,
  end_at INTEGER,
  cap INTEGER NOT NULL,
  held INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  ended_at INTEGER,
  cancelled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS participants (
  event_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  username TEXT NOT NULL,
  avatar_hash TEXT,
  seat TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, discord_id)
);
CREATE TABLE IF NOT EXISTS event_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  alive INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_participants_event ON participants(event_id);
CREATE INDEX IF NOT EXISTS idx_messages_event ON event_messages(event_id);
`;

let _db = null;

export function openDb(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

/** 进程单例（Next dev 下每个路由复用）。 */
export function getDb() {
  if (!_db) _db = openDb(process.env.DB_PATH || ":memory:");
  return _db;
}

/** 立即事务（写串行化；抢席/递补必须走这里）。 */
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const out = fn();
    db.exec("COMMIT;");
    return out;
  } catch (e) {
    try { db.exec("ROLLBACK;"); } catch { /* noop */ }
    throw e;
  }
}

export function upsertUser(db, { discordId, username, avatarHash }) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (discord_id, username, avatar_hash, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (discord_id) DO UPDATE SET username = excluded.username, avatar_hash = excluded.avatar_hash`,
  ).run(discordId, username, avatarHash ?? null, now);
}

export function createEvent(db, e) {
  db.prepare(
    `INSERT INTO events (id, creator_discord_id, game_text, game_id, start_at, end_at, cap, held, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(e.id, e.creatorDiscordId, e.gameText, e.gameId ?? null, e.startAt, e.endAt ?? null, e.cap, e.held ?? 0, e.description ?? "", Date.now());
  return getEvent(db, e.id);
}

export function getEvent(db, id) {
  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(id);
  return row ? mapEvent(db, row) : null;
}

export function listEventsByCreator(db, discordId) {
  return db
    .prepare("SELECT * FROM events WHERE creator_discord_id = ? ORDER BY created_at DESC")
    .all(discordId)
    .map((r) => mapEvent(db, r));
}

function mapEvent(db, r) {
  const counts = db
    .prepare("SELECT seat, COUNT(*) AS n FROM participants WHERE event_id = ? GROUP BY seat")
    .all(r.id);
  let confirmed = 0, waitlisted = 0;
  for (const c of counts) {
    if (c.seat === "confirmed") confirmed = c.n;
    else if (c.seat === "waitlisted") waitlisted = c.n;
  }
  return {
    id: r.id,
    creatorDiscordId: r.creator_discord_id,
    gameText: r.game_text,
    gameId: r.game_id,
    startAt: r.start_at,
    endAt: r.end_at,
    cap: r.cap,
    held: r.held,
    description: r.description,
    endedAt: r.ended_at,
    cancelled: r.cancelled === 1,
    confirmed,
    waitlisted,
    createdAt: r.created_at,
  };
}

export function listParticipants(db, eventId) {
  return db
    .prepare("SELECT * FROM participants WHERE event_id = ? ORDER BY joined_at ASC")
    .all(eventId)
    .map((r) => ({
      discordId: r.discord_id,
      username: r.username,
      avatarHash: r.avatar_hash,
      seat: r.seat,
      joinedAt: r.joined_at,
    }));
}

export function addMessage(db, { eventId, guildId, channelId, messageId }) {
  db.prepare(
    "INSERT INTO event_messages (event_id, guild_id, channel_id, message_id, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(eventId, guildId, channelId, messageId, Date.now());
}

export function liveMessages(db, eventId) {
  return db.prepare("SELECT * FROM event_messages WHERE event_id = ? AND alive = 1").all(eventId);
}

export function markMessageDead(db, id) {
  db.prepare("UPDATE event_messages SET alive = 0 WHERE id = ?").run(id);
}

export function endEvent(db, id) {
  db.prepare("UPDATE events SET ended_at = ? WHERE id = ?").run(Date.now(), id);
}

export function cancelEvent(db, id) {
  db.prepare("UPDATE events SET cancelled = 1 WHERE id = ?").run(id);
}
