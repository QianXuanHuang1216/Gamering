/** 纯展示 helper：相对时间文案（toLocaleString 绝对时间由调用方直出）。逻辑不动。 */

export function relText(ts, now = Date.now()) {
  const diff = new Date(ts).getTime() - now;
  const abs = Math.abs(diff);
  const m = Math.floor(abs / 60000);
  const h = Math.floor(abs / 3600000);
  const d = Math.floor(abs / 86400000);
  const s = d > 0 ? `${d} 天` : h > 0 ? `${h} 小时` : m > 0 ? `${m} 分钟` : "不到 1 分钟";
  return diff >= 0 ? `${s}后` : `${s}前`;
}

export const STATUS_META = {
  scheduled: { label: "未开始", icon: "schedule", cls: "badge-scheduled" },
  live: { label: "正在进行", icon: null, cls: "badge-live" },
  ended: { label: "已结束", icon: "check", cls: "badge-terminal" },
  cancelled: { label: "已取消", icon: "cancel", cls: "badge-terminal" },
};
