"use client";

import { usePathname } from "next/navigation";

/** 自适应导航：compact 底导航 / medium+ Rail 80dp / expanded Drawer（§3 全局）。 */
export default function AppNav({ loggedIn }) {
  const path = usePathname() ?? "";
  const isNew = path.startsWith("/events/new");
  const isMe = path.startsWith("/me");
  const items = [
    { href: "/events/new", icon: "add_circle", label: "建事件", current: isNew },
    { href: "/me", icon: "event_list", label: "我的事件", current: isMe },
  ];
  if (!loggedIn) return null;
  return (
    <>
      <nav className="app-bottomnav" aria-label="底部导航" data-testid="bottomnav">
        {items.map((it) => (
          <a key={it.href} href={it.href} aria-current={it.current ? "page" : undefined}>
            <span className="msr">{it.icon}</span>
            {it.label}
          </a>
        ))}
      </nav>
      <nav className="app-rail" aria-label="侧边导航" data-testid="rail">
        {items.map((it) => (
          <a key={it.href} href={it.href} aria-current={it.current ? "page" : undefined}>
            <span className="msr">{it.icon}</span>
            {it.label}
          </a>
        ))}
      </nav>
      <nav className="app-drawer" aria-label="抽屉导航" data-testid="drawer">
        {items.map((it) => (
          <a key={it.href} href={it.href} aria-current={it.current ? "page" : undefined}>
            <span className="msr">{it.icon}</span>
            {it.label}
          </a>
        ))}
      </nav>
    </>
  );
}
