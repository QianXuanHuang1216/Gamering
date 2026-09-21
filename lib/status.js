// 纯时间派生状态机（design-spec §5）。
// cancelled（终态）> 时间推导；改时间即重算；人满不碰状态（与容量正交，§6）。

export const STATUS = {
  SCHEDULED: "scheduled",
  LIVE: "live",
  ENDED: "ended",
  CANCELLED: "cancelled",
};

/**
 * @param {{ startAt: Date|string, endAt?: Date|string|null, endedAt?: Date|string|null, cancelled?: boolean }} event
 * @param {Date} [now]
 * @returns {"scheduled"|"live"|"ended"|"cancelled"}
 */
export function deriveStatus(event, now = new Date()) {
  if (event.cancelled) return STATUS.CANCELLED;
  if (event.endedAt) return STATUS.ENDED;
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const start = new Date(event.startAt).getTime();
  if (Number.isNaN(start)) throw new Error("invalid startAt");
  if (t < start) return STATUS.SCHEDULED;
  if (event.endAt == null) return STATUS.LIVE; // 结束待定：永不自动结束
  const end = new Date(event.endAt).getTime();
  if (Number.isNaN(end)) throw new Error("invalid endAt");
  return t > end ? STATUS.ENDED : STATUS.LIVE;
}

/** Discord Container accent（design-spec §5），hex + int 双写。 */
export const ACCENT = {
  scheduled: { hex: "#5865F2", int: 5793266 },
  live: { hex: "#57F287", int: 5763719 },
  ended: { hex: "#95A5A6", int: 9807270 },
  cancelled: { hex: "#747F8D", int: 7634829 },
};

export function accentFor(status) {
  const a = ACCENT[status];
  if (!a) throw new Error(`unknown status: ${status}`);
  return a;
}
