import { cookies } from "next/headers";
import { readSession } from "@/lib/session";
import { loginHref } from "@/lib/invite";
import InviteCard from "./invite-card";

export default async function Home({ searchParams }) {
  const params = await searchParams;
  const discordId = readSession(cookies().toString());
  return (
    <main className="stack">
      <h1 className="t-headline-medium">Gamering</h1>
      <p className="t-body-medium" style={{ margin: 0 }}>
        Discord 组队事件：建事件、推送到群、点按钮参加。
      </p>
      {params?.error && (
        <div className="snackbar snackbar-error" role="alert">
          登录失败：{params.error}
        </div>
      )}
      {discordId ? (
        <div className="card">
          <p className="t-body-large" style={{ margin: "0 0 12px" }}>
            已登录
          </p>
          <div className="row-wrap">
            <a className="btn btn-filled" href="/events/new">
              <span className="msr md-18">add</span>建事件
            </a>
            <a className="btn btn-tonal" href="/me">
              <span className="msr md-18">event_list</span>我的事件
            </a>
            <a className="btn btn-text" href="/api/auth/logout">
              退出
            </a>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="empty" data-testid="home-login-empty">
            <span className="empty-illo">
              <span className="msr">sports_esports</span>
            </span>
            <p className="t-title-medium">用 Discord 登录开始组队</p>
            <a className="btn btn-filled" href="/api/auth/login">
              <span className="msr md-18">login</span>用 Discord 登录
            </a>
          </div>
        </div>
      )}
      {/* SPA-499：主页常驻邀请卡（第二顺位，首屏可发现）。S0 服务端直渲；S1/S2/E 由客户端组件 fetch /api/guilds。 */}
      <div className="card" id="invite" tabIndex={-1} data-testid="home-invite-card">
        {!discordId ? (
          <div className="empty" data-testid="home-invite-s0">
            <span className="empty-illo">
              <span className="msr">group_add</span>
            </span>
            <p className="t-title-medium">把 Gamering Bot 拉进你的服务器</p>
            <p className="t-body-medium">先用 Discord 登录，回来继续邀请，上下文不丢</p>
            <a className="btn btn-filled" href={loginHref("/?invite=1")}>
              <span className="msr md-18">login</span>登录后邀请 Bot
            </a>
          </div>
        ) : (
          <InviteCard />
        )}
      </div>
    </main>
  );
}
