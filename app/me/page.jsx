import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { getDb, listEventsByCreator } from "@/lib/db";
import { eventStatus } from "@/lib/view";

export default async function Me() {
  const discordId = readSession(cookies().toString());
  if (!discordId) redirect("/api/auth/login");
  const events = listEventsByCreator(getDb(), discordId);
  const groups = { scheduled: [], live: [], ended: [], cancelled: [] };
  for (const e of events) groups[eventStatus(e)].push(e);
  const names = { scheduled: "未开始", live: "正在进行", ended: "已结束", cancelled: "已取消" };
  return (
    <main>
      <h1>我的事件</h1>
      <p>
        <a href="/events/new">建事件</a> · <a href="/">首页</a>
      </p>
      {Object.entries(groups).map(([k, list]) => (
        <section key={k}>
          <h2>
            {names[k]}（{list.length}）
          </h2>
          {list.length === 0 ? (
            <p>还没有{names[k]}的事件</p>
          ) : (
            <ul>
              {list.map((e) => (
                <li key={e.id}>
                  <a href={`/e/${e.id}`}>{e.gameText}</a> · {e.confirmed + e.held}/{e.cap} · 排队 {e.waitlisted}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  );
}
