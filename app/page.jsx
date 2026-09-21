import { cookies } from "next/headers";
import { readSession } from "@/lib/session";

export default async function Home({ searchParams }) {
  const discordId = readSession(cookies().toString());
  return (
    <main>
      <h1>Gamering</h1>
      {searchParams?.error && <p style={{ color: "red" }}>登录失败：{searchParams.error}</p>}
      {discordId ? (
        <>
          <p>已登录：{discordId}</p>
          <p>
            <a href="/events/new">建事件</a> · <a href="/me">我的事件</a> · <a href="/api/auth/logout">退出</a>
          </p>
        </>
      ) : (
        <p>
          <a href="/api/auth/login">用 Discord 登录</a>
        </p>
      )}
    </main>
  );
}
