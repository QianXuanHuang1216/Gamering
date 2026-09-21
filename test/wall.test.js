import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rosterHash, wallUrl, wallDimensions, renderWallPng } from "../lib/wall.js";
import { buildCardPayload } from "../lib/card.js";

const P = (discordId, avatarHash = null, joinedAt = 1) => ({ discordId, avatarHash, seat: "confirmed", joinedAt });

function pngSize(buf) {
  assert.equal(buf[0], 0x89);
  assert.equal(buf[1], 0x50); // PNG signature
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return { width: w, height: h };
}

describe("SPA-503 A方案：roster 哈希（缓存 bust）", () => {
  it("同名单哈希稳定；12 位 hex", () => {
    const parts = [P("1", "a"), P("2")];
    assert.match(rosterHash(parts), /^[0-9a-f]{12}$/);
    assert.equal(rosterHash(parts), rosterHash(parts));
  });
  it("加入/退出/换头像都改变哈希", () => {
    const base = [P("1", "a"), P("2", "b")];
    const h0 = rosterHash(base);
    assert.notEqual(rosterHash([...base, P("3")]), h0, "有人加入");
    assert.notEqual(rosterHash(base.slice(0, 1)), h0, "有人退出");
    assert.notEqual(rosterHash([P("1", "zzz"), P("2", "b")]), h0, "换头像");
  });
});

describe("SPA-503 A方案：wallUrl 固定路由 + roster 哈希", () => {
  it("格式 /api/events/{id}/wall.png?v={hash}，去尾部分斜杠", () => {
    const parts = [P("1", "a")];
    assert.equal(wallUrl("https://site/", "evt1", parts), `https://site/api/events/evt1/wall.png?v=${rosterHash(parts)}`);
  });
});

describe("SPA-503 A方案：固定画布（1/2/5/10 人同尺寸）", () => {
  it("四档 dimensions 恒定", () => {
    const d1 = wallDimensions(1);
    for (const n of [2, 5, 10]) assert.deepEqual(wallDimensions(n), d1, `${n} 人`);
  });
  it("渲染出的 PNG 四档像素尺寸恒定且为合法 PNG", async () => {
    const sizes = new Set();
    for (const n of [1, 2, 5, 10]) {
      const parts = Array.from({ length: n }, (_, i) => P(`u${i}`, null, i + 1));
      const buf = await renderWallPng(parts, { fetchFn: async () => { throw new Error("offline"); } });
      const { width, height } = pngSize(buf);
      assert.deepEqual({ width, height }, wallDimensions(n));
      sizes.add(`${width}x${height}`);
    }
    assert.equal(sizes.size, 1, `四档 PNG 尺寸必须唯一，实际 ${[...sizes]}`);
  });
  it("名单变化 → 图片字节变化（旧图不可能复用）", async () => {
    const noNet = { fetchFn: async () => { throw new Error("offline"); } };
    const a = await renderWallPng([P("1"), P("2")], noNet);
    const b = await renderWallPng([P("1"), P("2"), P("3")], noNet);
    assert.notDeepEqual(a, b);
  });
});

describe("SPA-503 A方案：卡片 gallery 恒为单 item", () => {
  const base = {
    id: "evt1", gameName: "G", startUnix: 1800000000, endUnix: null,
    cap: 10, confirmed: 2, held: 0, waitlisted: 0,
    participants: [P("1", "a", 1), P("2", "b", 2)],
    description: "d", status: "scheduled",
  };
  const galleryOf = (p) => p.components[0].components.find((c) => c.type === 12);
  it("2 人也只有 1 个 item，URL 带 roster 哈希", () => {
    const p = buildCardPayload(base, "https://site");
    const g = galleryOf(p);
    assert.equal(g.items.length, 1);
    assert.ok(g.items[0].media.url.startsWith("https://site/api/events/evt1/wall.png?v="), g.items[0].media.url);
  });
  it("1/5/10 人 gallery URL 尺寸语义一致（同路由同参格式）", () => {
    const urls = [1, 5, 10].map((n) => {
      const e = { ...base, participants: Array.from({ length: n }, (_, i) => P(`u${i}`, null, i + 1)) };
      const g = galleryOf(buildCardPayload(e, "https://site"));
      assert.equal(g.items.length, 1);
      return g.items[0].media.url;
    });
    assert.equal(new Set(urls.map((u) => u.split("?")[0])).size, 1);
  });
  it("0 人无 gallery；超 10 人仍单 item + 溢出提示行保留", () => {
    const none = galleryOf(buildCardPayload({ ...base, participants: [] }, "https://site"));
    assert.equal(none, undefined);
    const many = { ...base, participants: Array.from({ length: 12 }, (_, i) => P(`u${i}`, null, i + 1)) };
    const p = buildCardPayload(many, "https://site");
    assert.equal(galleryOf(p).items.length, 1);
    assert.ok(p.components[0].components.some((c) => c.content?.includes("等 2 人")));
  });
});
