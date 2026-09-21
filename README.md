# Gamering — 组队事件网站

SPA-493 下的子实现（SPA-495：OAuth + 事件 CRUD + Bot 发卡与交互 + 多卡同步 + 部署）。

设计规范：见 SPA-494 附件 `design-spec.md`（M3E token + Discord 卡片映射，§5 状态机 / §6 解耦规则 / §7 卡片结构为准）。

## 结构

- `lib/` — 纯域逻辑（无密钥可测）：状态机、容量行、头像 URL、`custom_id`、卡片 payload
- `test/` — `node:test` 单测（含并发抢席与递补用例，后续补）
- `app/` — Next.js App Router（tracer-bullet 阶段搭建）

## 本地开发

`npm test`
