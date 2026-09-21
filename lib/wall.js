// SPA-503 A方案：服务端合成头像墙单图。
// Discord Media Gallery 的 item 展示尺寸由客户端按数量自行排布（1 item 小、2+ 并排放大），
// API 无尺寸参数可控。故服务端把头像拼成一条固定画布 strip，本站出图，gallery 恒放 1 个 item。
// 画布按 WALL_LIMIT 封顶固定宽高（10 人以内永远同一尺寸），人数变化不改变图片尺寸。
// Discord CDN 图片代理有缓存：URL 带 roster 哈希 ?v=<hash>，名单/头像一变即换 URL。

import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { createRequire } from "node:module";
import { avatarUrl } from "./discord.js";

export const WALL_AVATAR = 48; // 每人圆点直径 px
export const WALL_GAP = 8;
export const WALL_PAD = 8;
export const WALL_PER_ROW = 10;
export const WALL_LIMIT = 10;

/** 名单哈希：展示顺序敏感（joinedAt 排序后传入），加入/退出/换头像/重排都换哈希。 */
export function rosterHash(participants) {
  const key = participants.map((p) => `${p.discordId}:${p.avatarHash ?? "-"}`).join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

/** 头像墙图片 URL（含缓存 bust 参数）。 */
export function wallUrl(siteUrl, eventId, participants) {
  const base = String(siteUrl).replace(/\/+$/, "");
  return `${base}/api/events/${eventId}/wall.png?v=${rosterHash(participants)}`;
}

/** 固定画布尺寸：人数 ≤ LIMIT 时恒定，与人数无关。 */
export function wallDimensions(_count) {
  const width = WALL_PAD * 2 + WALL_PER_ROW * WALL_AVATAR + (WALL_PER_ROW - 1) * WALL_GAP;
  const height = WALL_PAD * 2 + WALL_AVATAR;
  return { width, height };
}

/** discordId → 确定性色相（头像拉取失败时的占位圆点颜色）。 */
export function hueFor(discordId) {
  const h = createHash("sha256").update(String(discordId)).digest();
  return h.readUInt16BE(0) % 360;
}

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA 裸缓冲 → PNG（零依赖编码，filter 0 全行）。 */
export function encodePng(rgba, width, height) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const _require = createRequire(import.meta.url);

/** PNG 字节 → { data, width, height }；pngjs 未安装或非 PNG 返回 null（调用方走占位圆点）。 */
export function decodePng(buf, decodeOverride) {
  try {
    if (decodeOverride) return decodeOverride(buf);
    const { PNG } = _require("pngjs");
    return PNG.sync.read(buf);
  } catch {
    return null;
  }
}

/** 双线性缩放到边长为 size 的正方形 RGBA。 */
export function resizeSquare(src, srcW, srcH, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = (x + 0.5) * (srcW / size) - 0.5;
      const sy = (y + 0.5) * (srcH / size) - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const y0 = Math.max(0, Math.floor(sy));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const y1 = Math.min(srcH - 1, y0 + 1);
      const fx = Math.min(1, Math.max(0, sx - x0));
      const fy = Math.min(1, Math.max(0, sy - y0));
      for (let c = 0; c < 4; c++) {
        const v =
          src[(y0 * srcW + x0) * 4 + c] * (1 - fx) * (1 - fy) +
          src[(y0 * srcW + x1) * 4 + c] * fx * (1 - fy) +
          src[(y1 * srcW + x0) * 4 + c] * (1 - fx) * fy +
          src[(y1 * srcW + x1) * 4 + c] * fx * fy;
        out[(y * size + x) * 4 + c] = Math.round(v);
      }
    }
  }
  return out;
}

/** 把头像画到画布第 i 格：圆形裁切；src=null 时画确定性占位圆点。 */
export function blitAvatar(canvas, canvasW, i, src) {
  const cx = WALL_PAD + i * (WALL_AVATAR + WALL_GAP);
  const cy = WALL_PAD;
  const r = WALL_AVATAR / 2;
  for (let y = 0; y < WALL_AVATAR; y++) {
    for (let x = 0; x < WALL_AVATAR; x++) {
      const dx = x + 0.5 - r;
      const dy = y + 0.5 - r;
      if (dx * dx + dy * dy > r * r) continue;
      const o = ((cy + y) * canvasW + (cx + x)) * 4;
      if (src) {
        const s = (y * WALL_AVATAR + x) * 4;
        const a = src[s + 3] / 255;
        canvas[o] = Math.round(src[s] * a + canvas[o] * (1 - a));
        canvas[o + 1] = Math.round(src[s + 1] * a + canvas[o + 1] * (1 - a));
        canvas[o + 2] = Math.round(src[s + 2] * a + canvas[o + 2] * (1 - a));
        canvas[o + 3] = 255;
      } else {
        canvas[o + 3] = 255;
      }
    }
  }
}

async function fetchAvatarRgba(p, fetchFn, decodeOverride) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetchFn(avatarUrl(p.discordId, p.avatarHash), { signal: controller.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const img = decodePng(buf, decodeOverride);
    if (!img || !img.width || !img.height) return null;
    return resizeSquare(Buffer.from(img.data), img.width, img.height, WALL_AVATAR);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 合成头像墙 PNG。participants 为展示顺序（joinedAt 升序）已截断 ≤ LIMIT 的名单。
 * 真头像拉取/解码失败逐人回退为确定性占位圆点，永远返回合法 PNG。
 */
export async function renderWallPng(participants, { fetchFn = globalThis.fetch, decodeOverride } = {}) {
  const shown = participants.slice(0, WALL_LIMIT);
  const { width, height } = wallDimensions(shown.length);
  const canvas = Buffer.alloc(width * height * 4); // 全透明底
  const settled = await Promise.all(shown.map((p) => fetchAvatarRgba(p, fetchFn, decodeOverride)));
  shown.forEach((p, i) => {
    const rgba = settled[i];
    if (!rgba) {
      const [rr, gg, bb] = hslToRgb(hueFor(p.discordId), 60, 55);
      const dot = Buffer.alloc(WALL_AVATAR * WALL_AVATAR * 4);
      for (let k = 0; k < dot.length; k += 4) { dot[k] = rr; dot[k + 1] = gg; dot[k + 2] = bb; dot[k + 3] = 255; }
      blitAvatar(canvas, width, i, dot);
    } else {
      blitAvatar(canvas, width, i, rgba);
    }
  });
  return encodePng(canvas, width, height);
}
