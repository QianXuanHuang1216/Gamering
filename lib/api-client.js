// SPA-548 A 段：SPA-545 从 push-box 抽出来的 fetch 出口，现在全前端共用一份。
// 前端组件的 fetch 只有 app/ 与 lib/api-client.js 里这一处（路由层的 fetch 算服务端出口，另算）。
//
// 三条规矩，别绕过这个模块自己 fetch：
//  1. 绝不 throw。调用方拿到的永远是 { ok, status, data, unreadable }。
//  2. 响应体读不懂（服务端崩了返 HTML 500 / 传输截断）算 unreadable，且**不算成功**：
//     2xx 只说明状态码到了，body 截断时服务端可能已经把卡发出去并落了库，界面一片空白
//     会让人再点一次，Discord / 库里就多一份。
//  3. 文案带上是哪个操作。保存失败不是发送失败，评论失败不是报名失败。
//     同一个故障在两个操作上，用户要知道该重试的是哪个。

/** 响应体不是 JSON 时的哨兵：JSON 解析失败与「服务端返回 null」必须能分开。 */
const UNPARSED = Symbol("unparsed");

/**
 * 传输层的通用文案（唯一来源）。推送专属的说法在 lib/push.js —— 那些是 Discord 特有的，
 * 不该让编辑/评论这些操作背「连不上 Discord」。B 段会把 PUSH_ERROR 的同款词改成引用这里。
 * 只有产品里真实存在的情况才允许出现在文案里：没有同步状态视图，就别把人指过去。
 */
export const API_ERROR = {
  /** 响应读不懂或 fetch 本身失败：不能替服务端猜它到底成没成。 */
  unreadable: "没有收到服务端的回复，请再试一次",
  /** 拿到了 JSON 错误体但没有可展示的 error。 */
  fallback: "操作失败，请再试一次",
};

/**
 * 发一个请求并把响应收敛成固定形状。
 * @param {string} url
 * @param {RequestInit} [init] 原样透传给 fetch
 * @returns {Promise<{ok: boolean, status: number, data: object|null, unreadable: boolean}>}
 */
export async function callApi(url, init) {
  try {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => UNPARSED);
    const unreadable = data === UNPARSED;
    return { ok: res.ok && !unreadable, status: res.status, data: unreadable ? null : data, unreadable };
  } catch {
    return { ok: false, status: 0, data: null, unreadable: true };
  }
}

/**
 * 把 callApi 的结果翻成一句用户能看懂的话。
 * @param {object} [r] callApi 的返回值
 * @param {string} op 该操作自己的名字（"保存" / "发送评论" / "结束"…），不许空
 * @returns {string} 空串 = 已确认成功
 */
export function apiErrorMessage({ ok = false, data = null, unreadable = false } = {}, op = "") {
  // unreadable 排在 ok 前面：2xx 但响应体读不懂不构成「已确认成功」（见文件头第 2 条）。
  if (unreadable) return `${op}失败：${API_ERROR.unreadable}`;
  if (ok) return "";
  // 服务端带回来的 error 一律照传（前后端同一份文案，说法不许分叉）。
  const reason = typeof data?.error === "string" ? data.error.trim() : "";
  return `${op}失败：${reason || API_ERROR.fallback}`;
}
