import "./globals.css";
import { cookies } from "next/headers";
import { readSession } from "@/lib/session";
import { getDb, getUser } from "@/lib/db";
import { avatarUrl } from "@/lib/discord";
import AppNav from "./nav";

export const metadata = { title: "Gamering", description: "Discord 组队事件" };

/** 全局：Small top app bar 64dp（标题 + 右侧头像/登录态）+ 自适应导航（§3 全局）。 */
export default async function RootLayout({ children }) {
  const discordId = readSession(cookies().toString());
  let user = null;
  if (discordId) {
    try {
      user = getUser(getDb(), discordId);
    } catch {
      user = null;
    }
  }
  return (
    <html lang="zh-CN">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Roboto+Flex:opsz,wght@8..144,400;8..144,500;8..144,600&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400,0,0&display=swap"
        />
      </head>
      <body>
        <header className="app-topbar" data-testid="topbar">
          <a className="brand" href="/">
            Gamering
          </a>
          <span className="spacer" />
          {user ? (
            <span className="topbar-user">
              <img className="topbar-avatar" src={avatarUrl(user.discord_id, user.avatar_hash)} alt="" width={32} height={32} />
              <span>{user.username}</span>
            </span>
          ) : (
            <a className="btn btn-filled" href="/api/auth/login" style={{ minHeight: 40 }}>
              <span className="msr md-18">login</span>登录
            </a>
          )}
        </header>
        <div className="app-shell">
          <AppNav loggedIn={!!user} />
          <div className="app-content">
            <div className="app-content-inner">{children}</div>
          </div>
        </div>
      </body>
    </html>
  );
}
