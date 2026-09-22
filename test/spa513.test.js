import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { visibleCommentActions } from "../lib/comments.js";

process.env.SESSION_SECRET ??= "test-secret";

const c = { authorDiscordId: "a" };

describe("SPA-513 回复入口与编辑/删除解耦", () => {
  it("非作者非房主：含回复、不含编辑/删除", () => {
    assert.deepEqual(
      visibleCommentActions({ comment: c, meId: "b", creatorId: "owner", terminal: false }),
      { reply: true, edit: false, del: false },
    );
  });

  it("作者本人：回复+编辑+删除", () => {
    assert.deepEqual(
      visibleCommentActions({ comment: c, meId: "a", creatorId: "owner", terminal: false }),
      { reply: true, edit: true, del: true },
    );
  });

  it("房主（非作者）：回复+删除、无编辑", () => {
    assert.deepEqual(
      visibleCommentActions({ comment: c, meId: "owner", creatorId: "owner", terminal: false }),
      { reply: true, edit: false, del: true },
    );
  });

  it("未登录访客：三者皆无（actionsFor 返回 null）", () => {
    assert.deepEqual(
      visibleCommentActions({ comment: c, meId: null, creatorId: "owner", terminal: false }),
      { reply: false, edit: false, del: false },
    );
  });

  it("终态事件：登录用户也无回复入口", () => {
    const out = visibleCommentActions({ comment: c, meId: "b", creatorId: "owner", terminal: true });
    assert.equal(out.reply, false);
  });
});
