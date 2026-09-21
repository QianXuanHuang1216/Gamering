// 后台 worker：重试队列消费 + 每分钟 ticker（时间跨越重绘）。
// 单实例进程内跑（launchd 托管唯一实例）；多实例部署时换分布式锁。

import { deriveStatus } from "./status.js";
import { cardPayload } from "./view.js";
import { patchCard, fanout } from "./discord-rest.js";
import {
  getEvent, liveMessages, markMessageDead, enqueueRetry,
  dueRetries, dropRetry, eventsWithLiveCards,
} from "./db.js";

const SITE = () => process.env.SITE_URL;
let lastTick = Date.now() - 65_000; // 启动即补一次，覆盖停机窗口

function statusAt(ev, t) {
  return deriveStatus({ startAt: ev.startAt, endAt: ev.endAt, endedAt: ev.endedAt, cancelled: ev.cancelled }, new Date(t));
}

/** 跑一次：返回 { retried, repWLpatched, crossed } 供日志/测试断言。 */
export async function runOnce(db, now = Date.now()) {
  const out = { retried: 0, repatched: 0, crossed: 0 };

  for (const r of dueRetries(db, now)) {
    const ev = getEvent(db, r.event_id);
    if (!ev) { dropRetry(db, r.id); continue; }
    const payload = cardPayload(db, ev, SITE());
    const res = await patchCard(r.channel_id, r.message_id, payload);
    if (res.ok) { dropRetry(db, r.id); out.retried++; }
    else if (res.status === 404 || res.status === 403) {
      const m = liveMessages(db, r.event_id).find((x) => x.message_id === r.message_id);
      if (m) markMessageDead(db, m.id);
      dropRetry(db, r.id);
    } else {
      enqueueRetry(db, { eventId: r.event_id, channelId: r.channel_id, messageId: r.message_id, status: res.status });
    }
  }

  for (const summary of eventsWithLiveCards(db)) {
    const ev = getEvent(db, summary.id);
    if (!ev) continue;
    if (statusAt(ev, lastTick) !== statusAt(ev, now)) {
      const payload = cardPayload(db, ev, SITE());
      const res = await fanout(db, { markMessageDead, enqueueRetry }, ev.id, liveMessages(db, ev.id), payload);
      out.repatched += res.filter((x) => x.ok).length;
      out.crossed++;
    }
  }
  lastTick = now;
  return out;
}

let timer = null;
/** 启动每分钟 ticker（测试/多调幂等）。 */
export function startWorker(db, { intervalMs = 60_000 } = {}) {
  if (timer) return timer;
  timer = setInterval(() => {
    runOnce(db).catch((e) => console.error("worker tick failed", e));
  }, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}
export function _resetTick(t = Date.now() - 65_000) { lastTick = t; }
