// Components V2 卡片 payload 组装（design-spec v2 §7；accent 语义 §5，解耦 §6）。
// v2 去 emoji（Bryan 决议，Designer 一句话替换）：标题/容量/满员行均为纯文案。
// 多卡 fan-out 同一 payload 全量 PATCH；终态卡全按钮 disabled（仅 Link 可点）。

import { accentFor } from "./status.js";
import { capacityLine, isFull } from "./seats.js";
import { avatarUrl, joinCustomId, leaveCustomId } from "./discord.js";

export const COMPONENTS_V2_FLAG = 1 << 15;
const TERMINAL = new Set(["ended", "cancelled"]);
const STATUS_WORD = { scheduled: "未开始", live: "进行中", ended: "已结束", cancelled: "已取消" };
const AVATAR_WALL_LIMIT = 10;
const DESC_LIMIT = 300;

/**
 * @param {object} event { id, gameName, startUnix, endUnix|null, cap, confirmed, held, waitlisted,
 *   participants: [{discordId, avatarHash?, seat, joinedAt}], description, status }
 * @param {string} siteUrl 如 https://gamering.bryan-huang.com
 */
export function buildCardPayload(event, siteUrl) {
  const status = event.status;
  const accent = accentFor(status).int;
  const terminal = TERMINAL.has(status);
  const titlePrefix = status === "cancelled" ? "【已取消】" : "";
  const timeLine =
    event.endUnix != null
      ? `<t:${event.startUnix}:F>（<t:${event.startUnix}:R>）～ <t:${event.endUnix}:F>`
      : `<t:${event.startUnix}:F>（<t:${event.startUnix}:R>） / 结束待定`;

  const components = [
    { type: 10, content: `${titlePrefix}${event.gameName} 【${STATUS_WORD[status]}】` },
    { type: 10, content: timeLine },
    { type: 14 },
    {
      type: 10,
      content: `${capacityLine({ confirmed: event.confirmed, held: event.held ?? 0, cap: event.cap, waitlisted: event.waitlisted })}`,
    },
  ];

  // 满员排队行：只追加橙色文字行，永不动 accent（§6 解耦硬规则）。
  if (isFull({ confirmed: event.confirmed, held: event.held ?? 0, cap: event.cap }) && event.waitlisted > 0) {
    components.push({ type: 10, content: `已满员，新报名将进入排队（排队 ${event.waitlisted}）` });
  }

  const wall = [...event.participants].sort((a, b) => a.joinedAt - b.joinedAt).slice(0, AVATAR_WALL_LIMIT);
  if (wall.length > 0) {
    components.push({
      type: 12,
      items: wall.map((p) => ({ media: { url: avatarUrl(p.discordId, p.avatarHash) } })),
    });
  }
  const overflow = event.participants.length - wall.length;
  if (overflow > 0) components.push({ type: 10, content: `等 ${overflow} 人 → 去网页查看全名单` });

  const desc = event.description ?? "";
  components.push({
    type: 10,
    content: desc.length > DESC_LIMIT ? desc.slice(0, DESC_LIMIT) + "…去网页看全文" : desc,
  });
  components.push({ type: 14 });
  components.push({
    type: 1,
    components: [
      { type: 2, style: 1, label: "参加", custom_id: joinCustomId(event.id), disabled: terminal },
      { type: 2, style: 2, label: "退出", custom_id: leaveCustomId(event.id), disabled: terminal },
      { type: 2, style: 5, label: "查看详情", url: `${siteUrl}/e/${event.id}` },
    ],
  });

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{ type: 17, accent_color: accent, components }],
  };
}
