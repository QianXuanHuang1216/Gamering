// DB 行 → 卡片/页面视图（状态派生 + 载荷组装入口）。
import { deriveStatus } from "./status.js";
import { buildCardPayload } from "./card.js";
import { getEvent, listParticipants } from "./db.js";

export function eventStatus(ev) {
  return deriveStatus({
    startAt: ev.startAt,
    endAt: ev.endAt,
    endedAt: ev.endedAt,
    cancelled: ev.cancelled,
  });
}

export function cardInput(db, ev) {
  const parts = listParticipants(db, ev.id);
  return {
    id: ev.id,
    gameName: ev.gameText,
    startUnix: Math.floor(ev.startAt / 1000),
    endUnix: ev.endAt == null ? null : Math.floor(ev.endAt / 1000),
    cap: ev.cap,
    confirmed: ev.confirmed,
    held: ev.held,
    waitlisted: ev.waitlisted,
    participants: parts,
    description: ev.description,
    status: eventStatus(ev),
  };
}

export function cardPayload(db, ev, siteUrl) {
  return buildCardPayload(cardInput(db, ev), siteUrl);
}

export function loadEventView(db, id) {
  const ev = getEvent(db, id);
  if (!ev) return null;
  return { ev, status: eventStatus(ev), participants: listParticipants(db, id) };
}
