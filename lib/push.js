// 推送失败的用户可见文案 + 结果映射。前端组件与 API 路由共用这一份，
// 免得同一个故障在两处各写一套说法（分叉过一次：路由说「已加入重试」，前端说「网络错误」）。
//
// 只有产品里真实存在的情况才允许出现在文案里：没有同步状态视图，就别把人指过去。
//
// SPA-548 B 段拆过一次：这里原本把「传输层通用词汇」和「推送专属词汇」混在一个 PUSH_ERROR
// 名字下。通用的那两句搬去了 lib/api-client.js（编辑/评论/报名也要用），下面只留推送自己的。
// PUSH_ERROR 这个名字不改——拆完之后它剩下的东西确实都是推送的。

import { API_ERROR } from "./api-client.js";

/** 推送失败的各种说法的唯一来源。改动前先确认产品里真有这个状态。 */
export const PUSH_ERROR = {
  /** 服务端连不上 Discord（5xx）。点名 Discord，所以是推送专属，不进通用模块。 */
  transport: "连不上 Discord，请再试一次",
  /** 响应不是 JSON / 请求本身失败：服务端的回复没拿到，不能替它猜。五条路共用的那一句。 */
  unreadable: API_ERROR.unreadable,
  /** Discord 429 限流。 */
  rateLimited: "发送太频繁，请过几秒再试",
  /** 兜底：拿到了 JSON 错误体但没有可展示的 error。 */
  fallback: "发送失败",
  // 下面三句只在「回程读不懂 → 查过 event_messages」之后出现（见 pushOutcome），
  // 不会作为服务端错误体下发，所以放在这里而不是路由里。
  /** 查到了：卡已经进 Discord 了。这时候说「请再试一次」就是在教人制造重复卡。 */
  alreadySent: "已经发出去了，Discord 里能看到这张卡",
  /** 查过了，确实没有：这时候才该请人重试。 */
  notSent: "没有发出去，可以重试",
  /** 查本身失败：宁可让人自己去 Discord 看一眼，也不给一个可能是错的「重试」指令。 */
  sendUnknown: "不确定有没有发出去，先去 Discord 里看一眼",
  /** 客户端带的 nonce 不合法（AC3 去重的前提）。用户可见文案同样只有这一处来源。 */
  nonceInvalid: "nonce 只能是不超过 25 字符的字符串或整数",
};

/** Discord 消息直链：能点开是最省事的确认方式。缺 id 就不给假链接。 */
export function discordMessageUrl({ guild_id, channel_id, message_id } = {}) {
  if (!guild_id || !channel_id || !message_id) return null;
  return `https://discord.com/channels/${guild_id}/${channel_id}/${message_id}`;
}

/**
 * 「刚才那一下到底成没成」→ 三种说法。
 * unreadable 那条「请再试一次」之所以危险，是因为它可能落在「卡已经进了 Discord、
 * 响应却没回来」的窗口里，用户照做就多一张卡。查过库才说话，说的才是真话。
 * @param {object} [v] AC1 只读查询的结果
 * @param {boolean} [v.ok] 查询本身成功（false = 不确定，不是「没发出去」）
 * @param {object|null} [v.data] { sent, message_id, guild_id, channel_id }
 * @returns {{ text: string, url: string|null }}
 */
export function pushOutcome(v) {
  if (!v?.ok) return { text: PUSH_ERROR.sendUnknown, url: null };
  if (!v.data?.sent) return { text: PUSH_ERROR.notSent, url: null };
  return { text: PUSH_ERROR.alreadySent, url: discordMessageUrl(v.data) };
}

/** 一次「发送手势」的 nonce：同一次手势的重发复用它，Discord 侧按 (作者, nonce) 去重。
 *  上限 25 字符（Discord 文档），16 位 hex 够用。确认发送成功后要换新的——用户主动再发
 *  一张是产品承诺的行为，不能被去重吞掉。 */
export function newPushNonce() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 客户端 nonce 的校验：undefined = 没带（不参与去重），null = 不合法（该拒）。 */
export function validNonce(nonce) {
  if (nonce === undefined || nonce === null) return undefined;
  if (typeof nonce === "number") return Number.isSafeInteger(nonce) ? nonce : null;
  if (typeof nonce !== "string") return null;
  const s = nonce.trim();
  return s.length > 0 && s.length <= 25 ? s : null;
}

/**
 * 推送结果 → 用户可见文案。三态严格分开，别再把服务端崩溃说成客户端断网。
 * 服务端带回来的 error 一律照传（前后端同一份文案，说法不许分叉）；5xx 只是没带
 * error 时的兜底——它可能只是「换个频道」这种可操作提示，不该被覆盖成「连不上 Discord」。
 * @param {object} [r]
 * @param {boolean} [r.ok] 响应成功（此时返回空串，不产生错误文案）
 * @param {number}  [r.status] HTTP 状态码
 * @param {object|null} [r.data] 已解析的 JSON 响应体
 * @param {boolean} [r.unreadable] 响应无法解析（HTML 错误页/传输截断）或 fetch 本身失败
 * @returns {string} 空串 = 已确认成功
 */
export function pushErrorMessage({ ok = false, status = 0, data = null, unreadable = false } = {}) {
  // unreadable 排在 ok 前面：2xx 但响应体读不懂不构成「已确认成功」（服务端可能已经把卡
  // 发进 Discord，界面一片空白会让人再点一次，Discord 里就多一张卡）。
  if (unreadable) return PUSH_ERROR.unreadable;
  if (ok) return "";
  if (status === 429) return PUSH_ERROR.rateLimited;
  const reason = typeof data?.error === "string" ? data.error.trim() : "";
  if (!reason) return status >= 500 ? PUSH_ERROR.transport : `失败：${PUSH_ERROR.fallback}`;
  return status >= 500 ? reason : `失败：${reason}`;
}

/** Discord 没答上来时的统一应答：5xx + JSON。路由层用它，杜绝异常逃出去变 HTML 500。 */
export function discordUnreachable() {
  return Response.json({ error: PUSH_ERROR.transport }, { status: 502 });
}

/**
 * Discord 主动拒收（4xx）时的应答。
 * 4xx 是确定性的：同一份 payload 再发一次还是同一个 4xx，所以**绝不说「请稍后重试」**——
 * 那是在教人做一件没用的事。带上 Discord 的错误码，用户能直接转述。
 * 跟 discordUnreachable 分开是因为它们是两种故障：一个是「没答上」，一个是「答了不收」。
 * @param {unknown} [code] Discord 错误体里的 code（如 50035）
 */
export function discordRejected(code) {
  return Response.json({ error: `Discord 拒绝了这条卡片${code ? `（错误码 ${code}）` : ""}` }, { status: 502 });
}
