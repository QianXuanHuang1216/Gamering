import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { openDb, createEvent, listParticipants, liveMessages, addMessage } from "../lib/db.js";
import { verifySignature, handleButtonClick, interactionUser, _clearCooldown } from "../lib/interactions.js";
import { signSession, readSession } from "../lib/session.js";

process.env.SESSION_SECRET = "test-secret";

describe("Ed25519 验签", () => {
  it("合法签名通过，篡改 body 不通过", () => {
    const kp = nacl.sign.keyPair();
    const pub = Buffer.from(kp.publicKey).toString("hex");
    const ts = "1726800000";
    const body = '{"type":1}';
    const sig = Buffer.from(nacl.sign.detached(new Uint8Array(Buffer.from(ts + body)), kp.secretKey)).toString("hex");
    assert.equal(verifySignature({ publicKeyHex: pub, signatureHex: sig, timestamp: ts, rawBody: body }), true);
    assert.equal(verifySignature({ publicKeyHex: pub, signatureHex: sig, timestamp: ts, rawBody: '{"type":2}' }), false);
  });
});

describe("参加/退出/递补（SQLite 事务内）", () => {
  let db;
  const EVT = "evt-tracer";
  beforeEach(() => {
    _clearCooldown();
    db = openDb(":memory:");
    createEvent(db, { id: EVT, creatorDiscordId: "owner", gameText: "Helldivers 2", startAt: Date.now() + 3600_000, endAt: null, cap: 2, held: 0, description: "tracer" });
  });
  const u = (id) => ({ id, username: `u${id}`, avatar: null });

  it("两席确认、第三人排队、退出时队首递补", () => {
    assert.deepEqual(handleButtonClick(db, { customId: `join:v1:${EVT}`, user: u("a"), now: 1000 }), { kind: "update", eventId: EVT });
    assert.deepEqual(handleButtonClick(db, { customId: `join:v1:${EVT}`, user: u("b"), now: 2000 }), { kind: "update", eventId: EVT });
    const r = handleButtonClick(db, { customId: `join:v1:${EVT}`, user: u("c"), now: 5000 });
    assert.equal(r.kind, "update");
    assert.match(r.note, /排队 #1/);
    // 重复参加 → noop
    assert.equal(handleButtonClick(db, { customId: `join:v1:${EVT}`, user: u("c"), now: 8000 }).kind, "noop");
    // a 退出 → b 仍 confirmed，c 递补
    assert.equal(handleButtonClick(db, { customId: `leave:v1:${EVT}`, user: u("a"), now: 11000 }).kind, "update");
    const seats = Object.fromEntries(listParticipants(db, EVT).map((p) => [p.discordId, p.seat]));
    assert.deepEqual(seats, { b: "confirmed", c: "confirmed" });
    // 未参加者退出 → noop
    assert.equal(handleButtonClick(db, { customId: `leave:v1:${EVT}`, user: u("z"), now: 14000 }).message, "你不在名单中");
  });

  it("冷却内连点丢弃", () => {
    handleButtonClick(db, { customId: `join:v1:${EVT}`, user: u("a"), now: 1000 });
    const r = handleButtonClick(db, { customId: `leave:v1:${EVT}`, user: u("a"), now: 1500 });
    assert.equal(r.kind, "noop");
    assert.match(r.message, /太快/);
  });

  it("终态事件拒绝参加", () => {
    db.prepare("UPDATE events SET cancelled = 1 WHERE id = ?").run(EVT);
    const r = handleButtonClick(db, { customId: `join:v1:${EVT}`, user: u("a"), now: 1000 });
    assert.equal(r.kind, "noop");
  });

  it("interaction 取用户（guild member 优先，免登录）", () => {
    const iu = interactionUser({ member: { user: { id: "1", username: "g", avatar: "h" } } });
    assert.deepEqual(iu, { id: "1", username: "g", avatar: "h" });
    assert.equal(interactionUser({}), null);
  });

  it("event_messages 存活卡记录", () => {
    addMessage(db, { eventId: EVT, guildId: "g", channelId: "c", messageId: "m" });
    assert.equal(liveMessages(db, EVT).length, 1);
  });
});

describe("会话签名", () => {
  it("签发后可读，篡改不可读", () => {
    const tok = signSession("123");
    assert.equal(readSession(`gamer_session=${tok}`), "123");
    assert.equal(readSession("gamer_session=xxx.yyy"), null);
  });
});
