// SPA-506 B：房主移除参加者（直接删除该行；有排队按退出递补晋升队首）。
import { promoteQueue } from "./seats.js";
import { transaction, getEvent, listParticipants } from "./db.js";

/**
 * @returns {{ removed: string, promotedId: string|null }}
 * 房主不可被移除；仅事件创建人可调（调用方/API 层鉴权）。
 */
export function removeMember(db, { eventId, discordId, creatorId }) {
  return transaction(db, () => {
    const ev = getEvent(db, eventId);
    if (!ev) throw new Error("事件不存在");
    if (ev.creatorDiscordId !== creatorId) throw new Error("forbidden");
    if (discordId === ev.creatorDiscordId) throw new Error("房主不可被移除");
    const mine = db.prepare("SELECT * FROM participants WHERE event_id = ? AND discord_id = ?").get(eventId, discordId);
    if (!mine) throw new Error("该用户不在名单中");
    db.prepare("DELETE FROM participants WHERE event_id = ? AND discord_id = ?").run(eventId, discordId);
    const rest = listParticipants(db, eventId);
    const { promotedId } = promoteQueue(rest.map((p) => ({ discordId: p.discordId, seat: p.seat, joinedAt: p.joinedAt })));
    if (promotedId) {
      db.prepare("UPDATE participants SET seat = 'confirmed' WHERE event_id = ? AND discord_id = ?").run(eventId, promotedId);
    }
    return { removed: discordId, promotedId };
  });
}
