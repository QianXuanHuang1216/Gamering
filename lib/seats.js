// 容量行 + 参加/退出/排队递补（design-spec §2/§6，本票 §5）。
// 全端统一文案：`{confirmed+held}/{cap} · 还差 {n} · 排队 {w}`，满员“还差 0”照常显示。

/** @returns {string} 如 `3/5 · 还差 2 · 排队 1` */
export function capacityLine({ confirmed, held = 0, cap, waitlisted = 0 }) {
  const lack = Math.max(0, cap - confirmed - held);
  return `${confirmed + held}/${cap} · 还差 ${lack} · 排队 ${waitlisted}`;
}

/** 满员（confirmed+held >= cap）时新报名进排队；排队与状态正交。 */
export function isFull({ confirmed, held = 0, cap }) {
  return confirmed + held >= cap;
}

export const SEAT = { CONFIRMED: "confirmed", WAITLISTED: "waitlisted" };

/**
 * 抢席判定（纯函数；并发安全由 DB 事务保证——UNIQUE(event_id, discord_id) + 事务内重算）。
 * @param {{ confirmedCount: number, held?: number, cap: number }} snapshot 事务内最新快照
 * @returns {"confirmed"|"waitlisted"}
 */
export function decideSeat({ confirmedCount, held = 0, cap }) {
  return confirmedCount + held < cap ? SEAT.CONFIRMED : SEAT.WAITLISTED;
}

/**
 * 退出递补：按 joined_at 排序，队首晋升 confirmed。
 * @param {Array<{ discordId: string, seat: string, joinedAt: number }>} participants 去掉退出者之后
 * @returns {{ promotedId: string|null, ranks: Map<string, number> }} promotedId 为递补者；ranks 为剩余排队序号(#n)
 */
export function promoteQueue(participants) {
  const queue = participants
    .filter((p) => p.seat === SEAT.WAITLISTED)
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const promotedId = queue.length > 0 ? queue[0].discordId : null;
  const ranks = new Map();
  queue.slice(promotedId ? 1 : 0).forEach((p, i) => ranks.set(p.discordId, i + 1));
  return { promotedId, ranks };
}
