import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { readSession } from "@/lib/session";
import { loadEventView } from "@/lib/view";
import { avatarUrl } from "@/lib/discord";
import { relText } from "@/lib/present";
import StatusBadge from "@/app/status-badge";
import AvatarImg from "@/app/avatar-img";
import PushBox from "./push-box";
import ManageBox from "./manage-box";
import DescBox from "./desc-box";

/** SSR 直出 OG 标签当分享 fallback（§8，逻辑不动）。 */
export async function generateMetadata({ params }) {
  const { id } = await params;
  const view = loadEventView(getDb(), id);
  if (!view) return { title: "事件不存在 | Gamering" };
  const { ev, status } = view;
  const title = `${ev.gameText} | Gamering`;
  const description = `${ev.confirmed + ev.held}/${ev.cap} · 排队 ${ev.waitlisted} · ${(ev.description || "").slice(0, 120)}`;
  return { title, description, openGraph: { title, description, type: "article" } };
}

/** P2 事件详情页（§3 P2）：主卡 16dp + 描述卡 + 参加者卡 + 房主区。逻辑不动。 */
export default async function EventDetail({ params }) {
  const { id } = await params;
  const view = loadEventView(getDb(), id);
  if (!view) notFound();
  const { ev, status, participants } = view;
  const discordId = readSession(cookies().toString());
  const mine = discordId === ev.creatorDiscordId;
  const full = ev.confirmed + ev.held >= ev.cap;
  const showQueueStrip = full && ev.waitlisted > 0;
  const now = Date.now();
  let queueNo = 0;

  const wall = participants.slice(0, 10);
  const heldSlots = Array.from({ length: Math.min(ev.held, Math.max(0, 10 - wall.length)) }, (_, i) => i);
  const extraCount = participants.length + ev.held - wall.length - heldSlots.length;

  return (
    <main className="stack" data-testid="event-detail">
      {/* 主卡 */}
      <section className="card card-main" aria-label="事件主卡">
        <div className="stack-8">
          <div className="row-wrap">
            <h1 className="t-title-large" style={{ flex: 1, minWidth: 0 }}>
              {ev.cancelled ? "【已取消】" : ""}
              {ev.gameText}
            </h1>
            <StatusBadge status={status} />
          </div>
          <div className="t-body-medium">
            <div>
              开始 {new Date(ev.startAt).toLocaleString()}（{relText(ev.startAt, now)}）
            </div>
            <div>
              结束{" "}
              {ev.endAt ? `${new Date(ev.endAt).toLocaleString()}（${relText(ev.endAt, now)}）` : "待定（结束后房主可手动结束）"}
            </div>
          </div>
          <p className="t-body-large-500" style={{ margin: 0 }}>
            {ev.confirmed + ev.held}/{ev.cap} · 还差 {Math.max(0, ev.cap - ev.confirmed - ev.held)} · 排队 {ev.waitlisted}
          </p>
          {showQueueStrip && (
            <div className="warn-strip" role="note">
              <span className="msr" aria-hidden>
                hourglass
              </span>
              已满员，新报名将进入排队（排队 {ev.waitlisted}）
            </div>
          )}
        </div>
      </section>

      {/* 描述卡 */}
      {ev.description && <DescBox text={ev.description} />}

      {/* 参加者卡 */}
      <section className="card" aria-label="参加者" data-testid="participants-card">
        <h2 className="t-title-medium">参加者（{participants.length + ev.held}）</h2>
        <div className="avatar-wall" style={{ marginTop: 12 }} aria-hidden={wall.length === 0 && heldSlots.length === 0}>
          {wall.map((p) => (
            <AvatarImg key={p.discordId} src={avatarUrl(p.discordId, p.avatarHash)} seed={p.discordId} alt="" size={40} />
          ))}
          {heldSlots.map((i) => (
            <img
              key={`held-${i}`}
              className="avatar-held"
              src={`https://cdn.discordapp.com/embed/avatars/${i % 6}.png`}
              alt=""
              width={40}
              height={40}
              loading="lazy"
              title="占位（无 Discord 身份）"
            />
          ))}
          {extraCount > 0 && (
            <a className="avatar-more" href="#participants">
              等{extraCount}人
            </a>
          )}
        </div>
        {(wall.length > 0 || heldSlots.length > 0) && extraCount > 0 && (
          <p className="t-body-medium" style={{ margin: "8px 0 0" }}>
            + 等 {extraCount} 人
          </p>
        )}
        <ul className="p-list" id="participants">
          {heldSlots.map((i) => (
            <li key={`held-row-${i}`}>
              <img
                className="avatar avatar-held"
                src={`https://cdn.discordapp.com/embed/avatars/${i % 6}.png`}
                alt=""
                width={40}
                height={40}
                loading="lazy"
                title="占位（无 Discord 身份）"
              />
              <span className="who">
                <div className="n">占位 {i + 1}</div>
                <div className="s">占位（无 Discord 身份）</div>
              </span>
            </li>
          ))}
          {participants.map((p) => {
            if (p.seat === "waitlisted") queueNo += 1;
            return (
              <li key={p.discordId}>
                <AvatarImg className="avatar" src={avatarUrl(p.discordId, p.avatarHash)} seed={p.discordId} alt="" size={40} />
                <span className="who">
                  <div className="n">{p.username}</div>
                  <div className="s">@{p.username}</div>
                </span>
                {p.seat === "confirmed" ? (
                  <span className="msr check-green" title="已确认" aria-label="已确认">
                    check
                  </span>
                ) : (
                  <span className="chip-label">排队 #{queueNo}</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* 非房主访客说明：网页不设参加按钮（SPA-493 已定） */}
      {!discordId && (
        <p className="t-body-medium" style={{ margin: 0 }}>
          去 Discord 频道点“参加”（网页不设参加按钮）。
        </p>
      )}

      {/* 房主区：分割线隔开 */}
      {mine && (
        <>
          <hr className="divider" />
          <div id="push">
            <PushBox id={ev.id} />
          </div>
          <ManageBox id={ev.id} status={status} />
        </>
      )}
    </main>
  );
}
