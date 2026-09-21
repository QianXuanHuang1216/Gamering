"use client";

import { useEffect } from "react";

/** P2-1 顶栏滚动态接线：scrollY > 8 时给 .app-topbar 加 .scrolled（globals.css 滚动态生效）。
 * 纯展示层：只切换 class，不碰逻辑/API/状态机。 */
export default function TopbarScrolled() {
  useEffect(() => {
    const onScroll = () => {
      document
        .querySelectorAll(".app-topbar")
        .forEach((el) => el.classList.toggle("scrolled", window.scrollY > 8));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return null;
}
