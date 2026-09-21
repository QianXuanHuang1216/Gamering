import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { readSession } from "@/lib/session";
import { loadEventView } from "@/lib/view";
import PushBox from "./push-box";
import ManageBox from "./manage-box";

/** SSR 直出 OG 标签当分享 fallback（本票 §8）。 */
export async function generateMetadata({ params }) {
  const view = loadEventView(getDb(), params.id);
  if (!view) return { title: "事件不存在 | Gamering" };
  const { ev, status } = view;
  const title = `${ev.gameText} | Gamering`;
  const description = `${ev.confirmed + ev.held}/${ev.cap} · 排队 ${ev.waitlisted} · ${(ev.description || "").slice(0, 120)}`;
  return { title, description, openGraph: { title, description, type: "article" } };
}

export default async function EventDetail({ params }) {
  const view = loadEventView(getDb(), params.id);
  if (!view) notFound();
  const { ev, status, participants } = view;
  const discordId = readSession(cookies().toString());
  const mine = discordId === ev.creatorDiscordId;
  return (
    <main>
      <h1>
        {ev.cancelled ? "【已取消】" : ""}
        {ev.gameText}
      </h1>
      <p>
        状态：{status} · {ev.confirmed + ev.held}/{ev.cap} · 还差 {Math.max(0, ev.cap - ev.confirmed - ev.held)} · 排队 {ev.waitlisted}
      </p>
      <p>
        开始：{new Date(ev.startAt).toLocaleString()} · 结束：
        {ev.endAt ? new Date(ev.endAt).toLocaleString() : "待定（结束后房主可手动结束）"}
      </p>
      {ev.description && <p style={{ whiteSpace: "pre-wrap" }}>{ev.description}</p>}
      <h2>参加者（{participants.length}）</h2>
      <ul>
        {participants.map((p) => (
          <li key={p.discordId}>
            {p.username} · {p.seat === "confirmed" ? "已确认" : "排队中"}
          </li>
        ))}
      </ul>
      {!discordId && <p>去 Discord 频道点“参加”（网页不设参加按钮）。</p>}
      {mine && (
        <>
          <PushBox id={ev.id} />
          <ManageBox id={ev.id} status={status} />
        </>
      )}
    </main>
  );
}
