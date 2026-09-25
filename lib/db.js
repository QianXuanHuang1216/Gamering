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
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at INTEGER,
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
  nonce TEXT,
  alive INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_participants_event ON participants(event_id);
CREATE INDEX IF NOT EXISTS idx_messages_event ON event_messages(event_id);
CREATE TABLE IF NOT EXISTS event_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  parent_id INTEGER,
  author_discord_id TEXT NOT NULL,
  author_username TEXT NOT NULL DEFAULT '',
  author_avatar_hash TEXT,
  body TEXT NOT NULL,
  request_id TEXT UNIQUE,
  edited_at INTEGER,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_event ON event_comments(event_id);
CREATE TRIGGER IF NOT EXISTS trg_comments_no_l3
BEFORE INSERT ON event_comments
WHEN NEW.parent_id IS NOT NULL
  AND (SELECT parent_id FROM event_comments WHERE id = NEW.parent_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'no_l3: 回复的 parent 必须是 L1');
END;
CREATE TABLE IF NOT EXISTS sync_retries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_due INTEGER NOT NULL,
  last_status INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_retries_due ON sync_retries(next_due);
`;

/** 轻量迁移：已存在的库补列/补表（幂等）。 */
export function migrate(db) {
  const cols = new Set(db.prepare("PRAGMA table_info(users)").all().map((c) => c.name));
  for (const [name, type] of [["access_token", "TEXT"], ["refresh_token", "TEXT"], ["token_expires_at", "INTEGER"]]) {
    if (!cols.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type};`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS sync_retries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_due INTEGER NOT NULL,
    last_status INTEGER,
    created_at INTEGER NOT NULL
  );`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_retries_due ON sync_retries(next_due);");
  db.exec(`CREATE TABLE IF NOT EXISTS event_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    parent_id INTEGER,
    author_discord_id TEXT NOT NULL,
    author_username TEXT NOT NULL DEFAULT '',
    author_avatar_hash TEXT,
    body TEXT NOT NULL,
    request_id TEXT UNIQUE,
    edited_at INTEGER,
    deleted_at INTEGER,
    created_at INTEGER NOT NULL
  );`);
  // 已存在库补列：评论作者头像（SPA-510 P0-1）
  try {
    const ccols = new Set(db.prepare("PRAGMA table_info(event_comments)").all().map((c) => c.name));
    if (ccols.size > 0 && !ccols.has("author_avatar_hash")) {
      db.exec("ALTER TABLE event_comments ADD COLUMN author_avatar_hash TEXT;");
    }
  } catch { /* 老库无评论表时 CREATE 已覆盖 */ }
  db.exec("CREATE INDEX IF NOT EXISTS idx_comments_event ON event_comments(event_id);");
  // SPA-546：活卡记下发出它的那次手势的 nonce，「刚才那一下成没成」才有判据
  // （不按手势过滤就会把上一次留下的活卡当成本次结果，等于没发却说发了）。
  try {
    const mcols = new Set(db.prepare("PRAGMA table_info(event_messages)").all().map((c) => c.name));
    if (mcols.size > 0 && !mcols.has("nonce")) db.exec("ALTER TABLE event_messages ADD COLUMN nonce TEXT;");
  } catch { /* 老库无消息表时 CREATE 已覆盖 */ }
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_comments_no_l3
  BEFORE INSERT ON event_comments
  WHEN NEW.parent_id IS NOT NULL
    AND (SELECT parent_id FROM event_comments WHERE id = NEW.parent_id) IS NOT NULL
  BEGIN
    SELECT RAISE(ABORT, 'no_l3');
  END;`);
}

let _db = null;

export function openDb(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  migrate(db);
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

export function upsertUser(db, { discordId, username, avatarHash, accessToken, refreshToken, tokenExpiresAt }) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (discord_id, username, avatar_hash, access_token, refresh_token, token_expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (discord_id) DO UPDATE SET username = excluded.username, avatar_hash = excluded.avatar_hash,
       access_token = excluded.access_token, refresh_token = excluded.refresh_token, token_expires_at = excluded.token_expires_at`,
  ).run(discordId, username, avatarHash ?? null, accessToken ?? null, refreshToken ?? null, tokenExpiresAt ?? null, now);
}

export function getUser(db, discordId) {
  return db.prepare("SELECT * FROM users WHERE discord_id = ?").get(discordId) ?? null;
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

/** 记一张活卡，并记住发出它的那次手势（nonce）——查询「刚才那一下成没成」靠它判别。
 *  同一张 Discord 消息只记一次：enforce_nonce 会让重发拿回原来那张，再插一行会让
 *  liveMessages 数出两张卡（fanout 也会对着同一张 PATCH 两遍）。已经标死的除外——
 *  那说明卡被删过又被去重返回了一次，补插回活卡才能让 fanout 继续更新它。
 *  nonce 存成字符串：validNonce 放行整数，而 JS 数字绑进 TEXT 列会被 node:sqlite
 *  存成 "12345.0"，查询再按 === 比就永远对不上（确实在 Discord 里的卡被读成没发出去）。 */
export function addMessage(db, { eventId, guildId, channelId, messageId, nonce = null }) {
  db.prepare(
    `INSERT INTO event_messages (event_id, guild_id, channel_id, message_id, nonce, created_at)
     SELECT ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM event_messages WHERE event_id = ? AND message_id = ? AND alive = 1
     )`,
  ).run(eventId, guildId, channelId, messageId, nonce == null ? null : String(nonce), Date.now(), eventId, messageId);
}

export function liveMessages(db, eventId) {
  return db.prepare("SELECT * FROM event_messages WHERE event_id = ? AND alive = 1").all(eventId);
}

/** 某频道里最近一张活卡（推送后回答「到底发出去没有」的唯一判据）。
 *  口径直接来自 liveMessages，不另写一套 SQL 判活——两处口径分叉过一次就会各说各话。
 *  带 nonce 时只认这一次手势发出来的那张：不带就退化成「这个频道以前有没有活卡」，
 *  上一张会被当成本次的结果——用户被告知「发出去了」却少发一张，且没人会发现。
 *  比较前两边都归一成字符串（存的是 TEXT，调用方可能给整数）；nonce 为 null/undefined
 *  一律按「没带手势」处理，老数据（nonce 列为 NULL）不该被顺手滤掉。 */
export function latestLiveCard(db, eventId, channelId, { nonce } = {}) {
  const want = nonce == null ? null : String(nonce);
  const rows = liveMessages(db, eventId).filter(
    (r) => r.channel_id === channelId && (want === null || (r.nonce != null && r.nonce === want)),
  );
  return rows.reduce((best, r) => (best === null || r.id > best.id ? r : best), null);
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

/** 重试队列（多卡 fan-out 429/5xx 进这里，worker 按 next_due 消费）。
 * 退避一律相对时间：429 用 Discord 给的 retry_after 秒数；其余指数退避
 * 60s * 2^attempts，封顶 32 倍。retryAfterSec 仅覆盖当次 due，不改变 attempts 曲线。 */
export function enqueueRetry(db, { eventId, channelId, messageId, status, retryAfterSec }) {
  const now = Date.now();
  const backoff = (attempts) => Math.min(60_000 * 2 ** attempts, 60_000 * 32);
  const dueIn = (attempts) =>
    retryAfterSec != null ? Math.max(0, retryAfterSec) * 1000 : backoff(attempts);
  const existing = db
    .prepare("SELECT * FROM sync_retries WHERE event_id = ? AND message_id = ?")
    .get(eventId, messageId);
  if (existing) {
    const attempts = existing.attempts + 1;
    db.prepare("UPDATE sync_retries SET attempts = ?, next_due = ?, last_status = ? WHERE id = ?").run(
      attempts,
      now + dueIn(attempts),
      status ?? null,
      existing.id,
    );
    return;
  }
  db.prepare(
    "INSERT INTO sync_retries (event_id, channel_id, message_id, attempts, next_due, last_status, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)",
  ).run(eventId, channelId, messageId, now + dueIn(0), status ?? null, now);
}

export function dueRetries(db, now = Date.now(), limit = 50) {
  return db.prepare("SELECT * FROM sync_retries WHERE next_due <= ? ORDER BY next_due ASC LIMIT ?").all(now, limit);
}

export function dropRetry(db, id) {
  db.prepare("DELETE FROM sync_retries WHERE id = ?").run(id);
}

/** 有活卡的事件（ticker 扫时间跨越用）。 */
export function eventsWithLiveCards(db) {
  return db
    .prepare(
      `SELECT DISTINCT e.* FROM events e JOIN event_messages m ON m.event_id = e.id WHERE m.alive = 1`,
    )
    .all()
    .map((r) => ({ id: r.id, startAt: r.start_at, endAt: r.end_at, endedAt: r.ended_at, cancelled: r.cancelled === 1 }));
}
