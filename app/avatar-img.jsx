"use client";

import { useEffect, useRef, useState } from "react";

/** 头像容错展示：CDN 404/裂图时回退默认头像（`embed/avatars/{(id>>22)%6}`，§6 公式）。
 * 虚线环（占位）只由调用方通过 className 显式加，真实用户永不加。 */
export default function AvatarImg({ src, seed, className = "", alt = "", size = 40, title }) {
  const [broken, setBroken] = useState(false);
  const ref = useRef(null);
  // SSR 直出后若图片在 hydration 前已失败，onError 收不到：挂载时补检一次。
  useEffect(() => {
    const el = ref.current;
    if (el && el.complete && el.naturalWidth === 0) setBroken(true);
  }, []);
  let idx = 0;
  try {
    idx = Number((BigInt(seed) >> 22n) % 6n);
  } catch {
    idx = 0;
  }
  const fallback = `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  return (
    <img
      ref={ref}
      src={broken ? fallback : src}
      onError={() => setBroken(true)}
      className={className}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      title={title}
    />
  );
}
