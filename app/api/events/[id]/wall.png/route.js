import { getDb, getEvent, listParticipants } from "@/lib/db";
import { WALL_LIMIT, rosterHash, renderWallPng } from "@/lib/wall";

// SPA-503 A方案：头像墙合成图。URL 带 ?v=<名单哈希>，哈希不变可长缓存，名单一变即换 URL。
export async function GET(_req, { params }) {
  const { id } = await params;
  const db = getDb();
  const ev = getEvent(db, id);
  if (!ev) return Response.json({ error: "not_found" }, { status: 404 });
  // 与 lib/card.js 取 wall 的口径一致：joinedAt 升序截断 LIMIT（listParticipants 已按 joined_at 排序）。
  const wall = listParticipants(db, id).slice(0, WALL_LIMIT);
  const png = await renderWallPng(wall);
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(png.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${rosterHash(wall)}"`,
    },
  });
}
