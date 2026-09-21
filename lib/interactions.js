// Interactions 业务分发（验签 + 参加/退出/递补）。
// 设计：route 层先验签、PING 直接回；业务函数同步写库（SQLite 本地 ms 级），
// 调用方以 UPDATE_MESSAGE(7) 回源卡，再 fan-out 其余卡 + ephemeral followup。

import nacl from "tweetnacl";
import { parseCustomId } from "./discord.js";
import { decideSeat, promoteQueue } from "./seats.js";
import { transaction, getEvent, listParticipants } from "./db.js";

export const PING = 1;
export const APPLICATION_COMMAND = 2;
export const MESSAGE_COMPONENT = 3;
export const RESP_PONG = 1;
export const RESP_EPHEMERAL = 4;
export const RESP_UPDATE_MESSAGE = 7;

function hex(s) {
  return Buffer.from(s, "hex");
}

/** 验 X-Signature-Ed25519（timestamp + rawBody）。 */
export function verifySignature({ publicKeyHex, signatureHex, timestamp, rawBody }) {
  try {
    const msg = Buffer.concat([Buffer.from(timestamp, "utf8"), Buffer.from(rawBody, "utf8")]);
    return nacl.sign.detached.verify(new Uint8Array(msg), new Uint8Array(hex(signatureHex)), new Uint8Array(hex(publicKeyHex)));
  } catch {
    return false;
  }
}

/** 用户冷却（进程内存，2s/人/事件；多实例部署时换共享存储）。 */
const cooldown = new Map();
export function checkCooldown(eventId, userId, now = Date.now()) {
  const k = `${eventId}:${userId}`;
  const last = cooldown.get(k);
  if (last !== undefined && now - last < 2000) return false;
  cooldown.set(k, now);
  return true;
}
export function _clearCooldown() { cooldown.clear(); }

/**
 * 处理按钮点击。返回 { kind, ... }：
 * - { kind: "update", eventId, note? } 状态变了，调用方重建 payload 回 type 7，note 有值则 followup
 * - { kind: "noop", message } 无变化，调用方回 ephemeral type 4
 */
export function handleButtonClick(db, { customId, user, eventId: _ignored, now = Date.now() }) {
  const parsed = parseCustomId(customId);
  if (!parsed) return { kind: "noop", message: "未知按钮，请刷新卡片重试" };
  const { action, eventId } = parsed;

  if (!checkCooldown(eventId, user.id, now)) {
    return { kind: "noop", message: "操作太快，稍后再试" };
  }

  return transaction(db, () => {
    const event = getEvent(db, eventId);
    if (!event) return { kind: "noop", message: "事件不存在或已删除" };
    if (event.cancelled || event.endedAt) return { kind: "noop", message: "事件已结束，报名已关闭" };

    const parts = listParticipants(db, eventId);
    const mine = parts.find((p) => p.discordId === user.id);

    if (action === "join") {
      if (mine?.seat === "confirmed") return { kind: "noop", message: "你已在名单中" };
      if (mine?.seat === "waitlisted") {
        const rank = parts.filter((p) => p.seat === "waitlisted" && p.joinedAt < mine.joinedAt).length + 1;
        return { kind: "noop", message: `你已在排队中（排队 #${rank}）` };
      }
      const seat = decideSeat({ confirmedCount: event.confirmed, held: event.held, cap: event.cap });
      db.prepare(
        "INSERT INTO participants (event_id, discord_id, username, avatar_hash, seat, joined_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(eventId, user.id, user.username, user.avatar ?? null, seat, now);
      if (seat === "confirmed") return { kind: "update", eventId };
      const rank = listParticipants(db, eventId).filter((p) => p.seat === "waitlisted" && p.joinedAt <= now).length;
      return { kind: "update", eventId, note: `已加入排队 #${rank}` };
    }

    if (action === "leave") {
      if (!mine) return { kind: "noop", message: "你不在名单中" };
      db.prepare("DELETE FROM participants WHERE event_id = ? AND discord_id = ?").run(eventId, user.id);
      const rest = listParticipants(db, eventId).filter((p) => p.discordId !== user.id);
      const { promotedId } = promoteQueue(rest.map((p) => ({ discordId: p.discordId, seat: p.seat, joinedAt: p.joinedAt })));
      if (promotedId) {
        db.prepare("UPDATE participants SET seat = 'confirmed' WHERE event_id = ? AND discord_id = ?").run(eventId, promotedId);
        return { kind: "update", eventId };
      }
      return { kind: "update", eventId };
    }

    return { kind: "noop", message: "未知操作" };
  });
}

/** 从 interaction 取点击用户（guild member 或 DM user）。 */
export function interactionUser(interaction) {
  const u = interaction.member?.user ?? interaction.user;
  return u ? { id: u.id, username: u.username ?? u.global_name ?? "unknown", avatar: u.avatar ?? null } : null;
}
