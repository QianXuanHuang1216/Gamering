import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { getDb, listEventsByCreator } from "@/lib/db";
import { eventStatus } from "@/lib/view";
import TabsBox from "./tabs-box";

/** P3 我的事件管理页（§3 P3）：四态 Tabs + badge + 终态区分。逻辑不动。 */
export default async function Me() {
  const discordId = readSession(cookies().toString());
  if (!discordId) redirect("/api/auth/login");
  const events = listEventsByCreator(getDb(), discordId);
  const groups = { scheduled: [], live: [], ended: [], cancelled: [] };
  for (const e of events) groups[eventStatus(e)].push(e);
  return (
    <main className="stack" data-testid="me-page">
      <h1 className="t-headline-medium">我的事件</h1>
      <TabsBox groups={groups} />
    </main>
  );
}
