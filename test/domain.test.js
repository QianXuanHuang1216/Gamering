import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveStatus, accentFor } from "../lib/status.js";
import { capacityLine, decideSeat, promoteQueue, isFull } from "../lib/seats.js";
import { avatarUrl, defaultAvatarUrl, joinCustomId, leaveCustomId, parseCustomId } from "../lib/discord.js";
import { buildCardPayload, COMPONENTS_V2_FLAG } from "../lib/card.js";

const D = (s) => new Date(s);

describe("状态机 §5：cancelled > 时间推导；人满不碰状态", () => {
  it("cancelled 终态优先于一切", () => {
    assert.equal(deriveStatus({ startAt: "2020-01-01T00:00:00Z", cancelled: true }, D("2026-01-01T00:00:00Z")), "cancelled");
  });
  it("ended_at 非空即已结束", () => {
    assert.equal(deriveStatus({ startAt: "2030-01-01T00:00:00Z", endedAt: "2026-01-01T00:00:00Z" }, D("2026-06-01T00:00:00Z")), "ended");
  });
  it("now<start 未开始；区间内进行中；now>end 已结束", () => {
    assert.equal(deriveStatus({ startAt: "2030-01-01T00:00:00Z" }, D("2026-01-01T00:00:00Z")), "scheduled");
    assert.equal(
      deriveStatus({ startAt: "2026-01-01T00:00:00Z", endAt: "2026-02-01T00:00:00Z" }, D("2026-01-15T00:00:00Z")),
      "live",
    );
    assert.equal(
      deriveStatus({ startAt: "2026-01-01T00:00:00Z", endAt: "2026-02-01T00:00:00Z" }, D("2026-03-01T00:00:00Z")),
      "ended",
    );
  });
  it("end 为空永不自动结束", () => {
    assert.equal(deriveStatus({ startAt: "2020-01-01T00:00:00Z", endAt: null }, D("2026-01-01T00:00:00Z")), "live");
  });
  it("accent 映射 hex+int", () => {
    assert.deepEqual(accentFor("scheduled"), { hex: "#5865F2", int: 5793266 });
    assert.deepEqual(accentFor("live"), { hex: "#57F287", int: 5763719 });
    assert.deepEqual(accentFor("ended"), { hex: "#95A5A6", int: 9807270 });
    assert.deepEqual(accentFor("cancelled"), { hex: "#747F8D", int: 7634829 });
  });
});

describe("容量行 §2/§6：统一文案；满员不隐藏还差 0", () => {
  it("3/5 · 还差 2 · 排队 1", () => {
    assert.equal(capacityLine({ confirmed: 3, held: 0, cap: 5, waitlisted: 1 }), "3/5 · 还差 2 · 排队 1");
  });
  it("占位 held 计入分子并扣减还差", () => {
    assert.equal(capacityLine({ confirmed: 2, held: 1, cap: 5, waitlisted: 0 }), "3/5 · 还差 2 · 排队 0");
  });
  it("满员显示还差 0", () => {
    assert.equal(capacityLine({ confirmed: 5, held: 0, cap: 5, waitlisted: 2 }), "5/5 · 还差 0 · 排队 2");
  });
});

describe("抢席与递补（并发抢席语义：快照判定 + 事务保证由 DB 层负责）", () => {
  it("有空位 confirmed；满员 waitlisted", () => {
    assert.equal(decideSeat({ confirmedCount: 3, held: 0, cap: 5 }), "confirmed");
    assert.equal(decideSeat({ confirmedCount: 5, held: 0, cap: 5 }), "waitlisted");
    assert.equal(decideSeat({ confirmedCount: 4, held: 1, cap: 5 }), "waitlisted");
  });
  it("模拟并发：同一快照下只有一个能 confirmed（调用方须在事务内重读）", () => {
    // 快照 confirmedCount=4/cap=5：第一个抢到后重读为 5，第二个只能排队
    assert.equal(decideSeat({ confirmedCount: 4, cap: 5 }), "confirmed");
    assert.equal(decideSeat({ confirmedCount: 5, cap: 5 }), "waitlisted");
  });
  it("退出时队首（joinedAt 最早）递补", () => {
    const { promotedId, ranks } = promoteQueue([
      { discordId: "c", seat: "waitlisted", joinedAt: 3 },
      { discordId: "a", seat: "confirmed", joinedAt: 1 },
      { discordId: "b", seat: "waitlisted", joinedAt: 2 },
    ]);
    assert.equal(promotedId, "b");
    assert.equal(ranks.get("c"), 1);
  });
  it("空队列无递补", () => {
    assert.equal(promoteQueue([{ discordId: "a", seat: "confirmed", joinedAt: 1 }]).promotedId, null);
  });
  it("isFull 含 held", () => {
    assert.equal(isFull({ confirmed: 4, held: 1, cap: 5 }), true);
    assert.equal(isFull({ confirmed: 4, held: 0, cap: 5 }), false);
  });
});

describe("头像与 custom_id §6/§7", () => {
  it("真人 CDN；无 hash 走默认公式", () => {
    assert.equal(avatarUrl("123", "abc"), "https://cdn.discordapp.com/avatars/123/abc.png?size=64");
    assert.match(avatarUrl("123", null), /^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
  });
  it("默认公式 (id>>22)%6", () => {
    const id = "81384788765712384";
    const idx = Number((BigInt(id) >> 22n) % 6n);
    assert.equal(defaultAvatarUrl(id), `https://cdn.discordapp.com/embed/avatars/${idx}.png`);
  });
  it("custom_id 版本命名空间往返", () => {
    assert.equal(joinCustomId("evt1"), "join:v1:evt1");
    assert.equal(leaveCustomId("evt1"), "leave:v1:evt1");
    assert.deepEqual(parseCustomId("join:v1:evt1"), { action: "join", eventId: "evt1" });
    assert.equal(parseCustomId("hack:v9:x"), null);
    assert.equal(parseCustomId(""), null);
  });
});

describe("卡片 payload §7：解耦 + 终态禁用", () => {
  const base = {
    id: "evt1", gameName: "Helldivers 2", startUnix: 1800000000, endUnix: null,
    cap: 5, confirmed: 5, held: 0, waitlisted: 2,
    participants: [{ discordId: "81384788765712384", avatarHash: null, seat: "confirmed", joinedAt: 1 }],
    description: "x".repeat(500),
  };
  const inner = (p) => {
    assert.equal(p.components.length, 1);
    assert.equal(p.components[0].type, 17);
    return p.components[0].components;
  };
  it("结构：单 Container 包裹（accent_color 挂 container 上）", () => {
    const p = buildCardPayload({ ...base, status: "scheduled" }, "https://site");
    assert.equal(p.components[0].accent_color, 5793266);
  });
  it("满员 live：accent 保持绿，只追加橙色排队行", () => {
    const p = buildCardPayload({ ...base, status: "live" }, "https://site");
    assert.equal(p.flags, COMPONENTS_V2_FLAG);
    assert.equal(p.components[0].accent_color, 5763719);
    assert.ok(inner(p).some((c) => c.content?.includes("已满员")));
  });
  it("终态：accent 灰 + 参加/退出 disabled，Link 可点", () => {
    for (const status of ["ended", "cancelled"]) {
      const p = buildCardPayload({ ...base, status }, "https://site");
      const row = inner(p).at(-1).components;
      assert.equal(row[0].disabled, true);
      assert.equal(row[1].disabled, true);
      assert.equal(row[2].disabled, undefined);
    }
  });
  it("取消标题前缀 + 长描述截断", () => {
    const p = buildCardPayload({ ...base, status: "cancelled" }, "https://site");
    assert.ok(inner(p)[0].content.includes("【已取消】"));
    assert.ok(inner(p).some((c) => c.content?.endsWith("…去网页看全文")));
  });
  it("v2 去 emoji：标题/容量/满员行均为纯文案（Designer 一句话替换锁定）", () => {
    for (const status of ["scheduled", "live", "ended", "cancelled"]) {
      const p = buildCardPayload({ ...base, status }, "https://site");
      const texts = inner(p).map((c) => c.content ?? "").join("\n");
      assert.ok(!texts.includes("🎮") && !texts.includes("👥") && !texts.includes("⚠️"), status);
    }
    const p = buildCardPayload({ ...base, status: "live" }, "https://site");
    assert.ok(inner(p)[0].content.includes("Helldivers 2 【进行中】"));
    assert.ok(inner(p).some((c) => c.content?.includes("已满员，新报名将进入排队（排队 2）")));
  });
});
