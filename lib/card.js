// Components V2 卡片 payload 组装（design-spec v2 §7；accent 语义 §5，解耦 §6）。
// v2 去 emoji（Bryan 决议，Designer 一句话替换）：标题/容量/满员行均为纯文案。
// 多卡 fan-out 同一 payload 全量 PATCH；终态卡全按钮 disabled（仅 Link 可点）。

import { accentFor } from "./status.js";
import { capacityLine, isFull } from "./seats.js";
import { joinCustomId, leaveCustomId } from "./discord.js";
import { WALL_LIMIT, wallUrl } from "./wall.js";

export const COMPONENTS_V2_FLAG = 1 << 15;
const TERMINAL = new Set(["ended", "cancelled"]);
const STATUS_WORD = { scheduled: "未开始", live: "进行中", ended: "已结束", cancelled: "已取消" };
const AVATAR_WALL_LIMIT = WALL_LIMIT;
const DESC_LIMIT = 300;
/** Discord Text Display 的 content 上限（BASE_TYPE_BAD_LENGTH 的另一头）。 */
const TEXT_MAX = 4000;

/**
 * 造一行文字（Text Display，type 10）。
 * 所有文字行都走这一个门，因为 Discord 对 content 的要求是 **1–4000 字符**：
 * 空串不是「这行不显示」，是整条消息以 400 / 50035 Invalid Form Body 被拒收
 * （2026-09-25 线上事故：描述为空的事件一张卡都发不出去）。
 * 新增文字行时不必再各自记得这道校验。
 */
function textRow(content) {
  if (typeof content !== "string" || content.trim() === "") return null;
  if (content.length <= TEXT_MAX) return { type: 10, content };
  // 别把代理对劈成半个（emoji 会被 Discord 判成非法转义），宁可少一个字符。
  const cut = content.slice(0, TEXT_MAX);
  return { type: 10, content: /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut };
}

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
    textRow(`${titlePrefix}${event.gameName} 【${STATUS_WORD[status]}】`),
    textRow(timeLine),
    { type: 14 },
    textRow(capacityLine({ confirmed: event.confirmed, held: event.held ?? 0, cap: event.cap, waitlisted: event.waitlisted })),
  ];

  // 满员排队行：只追加橙色文字行，永不动 accent（§6 解耦硬规则）。
  if (isFull({ confirmed: event.confirmed, held: event.held ?? 0, cap: event.cap }) && event.waitlisted > 0) {
    components.push(textRow(`已满员，新报名将进入排队（排队 ${event.waitlisted}）`));
  }

  // SPA-503 A方案：头像墙服务端合成单图，gallery 恒 1 item（Discord 按 item 数量排布，
  // 多 item 并排会放大，API 无尺寸参数可控）。名单哈希进 URL bust Discord 图片代理缓存。
  const wall = [...event.participants].sort((a, b) => a.joinedAt - b.joinedAt).slice(0, AVATAR_WALL_LIMIT);
  if (wall.length > 0) {
    components.push({
      type: 12,
      items: [{ media: { url: wallUrl(siteUrl, event.id, wall) } }],
    });
  }
  const overflow = event.participants.length - wall.length;
  if (overflow > 0) components.push(textRow(`等 ${overflow} 人 → 去网页查看全名单`));

  const desc = event.description ?? "";
  components.push(textRow(desc.length > DESC_LIMIT ? desc.slice(0, DESC_LIMIT) + "…去网页看全文" : desc));
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
    // textRow 对空白返回 null（不产出会被拒的空行），这里滤掉，不改变其余行的相对顺序。
    components: [{ type: 17, accent_color: accent, components: components.filter(Boolean) }],
  };
}
