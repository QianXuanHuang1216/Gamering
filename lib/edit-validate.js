// SPA-506 B/C：事件编辑约束 + 时间校验/默认填充（纯函数，可单测）。

/** cap 下限 = confirmed + held。 */
export function capFloor({ confirmed, held = 0 }) {
  return confirmed + held;
}

/**
 * 编辑 patch 校验。返回错误文案（中文），通过返回 null。
 * patch 可含：game_text, start_at, end_at(ms), cap, held, description。
 */
export function validateEventEdit({ patch, confirmed, held = 0, cap }) {
  const nextCap = patch.cap ?? cap ?? capFloor({ confirmed, held });
  const nextHeld = patch.held ?? held;
  if (patch.game_text != null) {
    const t = String(patch.game_text).trim();
    if (!t) return "标题不能为空";
    if (t.length > 80) return "标题 ≤80 字";
  }
  if (patch.cap != null) {
    const c = Number(patch.cap);
    if (!Number.isInteger(c) || c < 1 || c > 100) return "总位置数须为 1–100";
    const floor = capFloor({ confirmed, held: nextHeld });
    if (c < floor) return `总位置数（${c}）小于当前参加人数（${floor}）。请先移除至少 ${floor - c} 人，或调大 cap，才能保存。`;
  }
  if (patch.held != null) {
    const h = Number(patch.held);
    if (!Number.isInteger(h) || h < 0 || h > nextCap) return "占位须为 0–上限";
    if (nextCap < capFloor({ confirmed, held: h })) {
      const floor = capFloor({ confirmed, held: h });
      return `总位置数（${nextCap}）小于当前参加人数（${floor}）。请先移除至少 ${floor - nextCap} 人，或调大 cap，才能保存。`;
    }
  }
  if (patch.description != null && String(patch.description).length > 2000) return "描述 ≤2000 字";
  if (patch.start_at != null || patch.end_at !== undefined) {
    const tErr = validateTimes({ startAt: patch.start_at, endAt: patch.end_at });
    if (tErr) return tErr;
  }
  return null;
}

/** 结束必须晚于开始（任一为空即待定，不报错）。 */
export function validateTimes({ startAt, endAt }) {
  if (startAt == null || endAt == null) return null;
  if (Number(endAt) <= Number(startAt)) return "结束时间必须晚于开始时间";
  return null;
}

const pad = (n) => String(n).padStart(2, "0");

/** 新建页默认：日期 = 今天，时间 = 当前分钟（本地时区）。 */
export function defaultStartParts(now = new Date()) {
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    hour: now.getHours(),
    minute: now.getMinutes(),
  };
}

/** 日历过去日期 disabled（按天比较，今天可选）。 */
export function isPastDate(yyyyMmDd, today = new Date()) {
  const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return yyyyMmDd < day(today);
}

/** 本地 parts → ms 时间戳。 */
export function partsToMs({ date, hour, minute }) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute, 0, 0).getTime();
}

/** ms → 本地 parts（编辑回填用）。 */
export function msToParts(ms) {
  const d = new Date(ms);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hour: d.getHours(),
    minute: d.getMinutes(),
  };
}
