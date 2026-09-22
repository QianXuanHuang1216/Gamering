# Gamering

给 Discord 群用的组队事件网站：建事件、报名抢席、Bot 往频道里发卡并随状态自动重绘，附两层评论。

## 5 分钟跑起来

前置：Node（本仓库在 v24 下验证通过）。

```bash
cp .env.example .env   # 然后把下面的 key 填上
npm install            # 不装的话有两个测试文件直接挂（缺 tweetnacl）
npm test               # 12 个测试文件，111 条，全过才往下走
npm run dev            # http://localhost:3000
```

`.env` 里 6 个 key，一个都不能少（全在 `.env.example` 里，没真值）：

| key | 干嘛的 |
|---|---|
| `DISCORD_CLIENT_ID` | Discord 应用 ID。登录拼授权链接、邀请 Bot 链接都用它 |
| `DISCORD_CLIENT_SECRET` | 授权码换 token，只在回调路由用，不出服务端 |
| `DISCORD_BOT_TOKEN` | Bot 发卡 / 改卡 / 预检频道权限，走 `Authorization: Bot ...` |
| `DISCORD_PUBLIC_KEY` | Interactions 验签公钥。验不过直接 401，卡上按钮全死 |
| `SESSION_SECRET` | 会话 HMAC 密钥，本地随便填个随机串；没填启动就报错 |
| `SITE_URL` | 对外基址。本地填 `http://localhost:3000` |

登录（Discord OAuth，`scope=identify guilds`）：点登录 → 跳 Discord 授权 → 回调
`/api/auth/callback/discord` 换 token、落库、发会话 cookie。

- 去 Discord Developer Portal 建应用，Redirect URI 填死一个：`{SITE_URL}/api/auth/callback/discord`，本地就是 `http://localhost:3000/api/auth/callback/discord`。填错就 `oauth_state` 报错跳回首页。
- Bot 页拿 token；首页空状态有一键邀请 Bot 链接（最小权限 19456：看频道 + 发消息 + 嵌链接），把它拉进你的服务器。
- 真值只放本地 `.env`，`.gitignore` 已屏蔽，严禁进 git。

## 目录结构

- `lib/` —— 纯域逻辑，不碰网络和密钥，能单测。改规则先看这。
  - `status.js` 状态机，`seats.js` 抢席/排队，`comments.js` 两层评论，`edit-validate.js` 编辑校验
  - `db.js` SQLite 存取（`node:sqlite`），`session.js` 会话 cookie，`discord.js` 头像/`custom_id` 编解码
  - `discord-rest.js` Bot 发卡/PATCH，`interactions.js` 按钮验签+事务，`view.js`/`card.js` 卡片组装
  - `wall.js` 头像墙 PNG，`worker.js` 后台重绘，`games.js` 游戏预设，`members.js` 移除递补，`invite.js` 跳转白名单，`present.js` 时间文案
- `app/` —— Next.js App Router。`app/api/` 是接口（auth / events / comments / interactions / guilds / health / wall.png），`app/e/[id]/` 是事件详情页（含评论/编辑/推送/管理四个 box），`app/events/new/` 新建页，`app/me/` 我的事件。改页面先看这。
- `test/` —— `node:test` 单测，`npm test` 跑的是 `test/*.test.js`（`alias-loader.js` 只是 `@/` 别名垫片，不是单测）。
- 根下 `instrumentation.js` 随 Next 启动后台 worker；`jsconfig.json` 定义 `@/*` 别名。

## 核心概念（一句话一个）

- 状态机（`lib/status.js`）：`cancelled` > `endedAt` 非空即 `ended` > 按时间推导（开始前 `scheduled`，否则 `live`，过了 `end` 变 `ended`）；`end` 为空=永不自动结束，恒 `live`；人满不影响状态。
- 席位（`lib/seats.js`）：`cap` 是总位置，`held` 是房主预留；`confirmed + held >= cap` 即满，新报名进排队；有人退出按 `joinedAt` 队首递补；抢席并发靠 `UNIQUE(event_id, discord_id)` + 事务内重算。
- 两层评论（`lib/comments.js`）：只有 L1 + L2，回复 L2 自动压平到同一 L1，DB trigger 兜底永不写 L3；有回复的 L1 删了留软删占位，其余硬删；编辑仅作者，删除加事件创建人；单条 ≤500 字。
- 编辑约束（`lib/edit-validate.js`）：`cap` 只能在 `1–100` 且不能小于 `confirmed + held`（小了先移除人或调大 cap）；标题 ≤80 字，描述 ≤2000 字；新建时开始时间必须晚于现在。

## 生产部署

- 起：`npm run build && npm start`（端口 3000），`SITE_URL` 换线上域名且 `https://` 开头（否则会话 cookie 没有 `Secure`）。
- 数据：`DB_PATH` 指向持久化文件（如 `~/persistent/gamering/data/gamering.db`，WAL 模式，目录自动建）；**不设 `DB_PATH` 默认跑 `:memory:`，重启丢数据**。切 Postgres 只改 `lib/db.js`，SQL 用的标准语法。
- 探活：`GET /api/health` 只回静态 `{status:"ok"}`，不查 DB、不查 Discord——它只能证明进程活着。真正的业务心跳是 `instrumentation.js` 拉起的 worker（每 60 秒重试失败的改卡 + 时间跨越重绘）。
- launchd 托管单实例 + 隧道 + 第二道检查按 SPA-495 在机器上配，不在仓库里；密钥只放机器上的 `.env`。

## 常见坑

1. `npm install` 没跑就 `npm test`：`sync`/`tracer` 两个文件级失败，报错 `Cannot find package 'tweetnacl'`。先装依赖。
2. 本地数据重启就没：`DB_PATH` 没设就是 `:memory:`。要持久化自己加 `DB_PATH=绝对路径`。
3. 建事件 400 "开始时间须晚于现在"：选的时间 <= 服务器 now。改编辑页时间同理，结束必须晚于开始。
4. 改 `cap` 保存失败：`cap` 不能小于 `confirmed + held`，报错里会写差几人，先移除或调大。
5. 卡上按钮点了没反应：连点 2 秒冷却（`checkCooldown`）；一直不行查 `DISCORD_PUBLIC_KEY`，验签 401 全灭。
6. `hidden` 不生效：带 `display`（如 `display:flex/grid`）的 class 会覆盖 `hidden` 属性，仓库用 `app/globals.css` 的 `[hidden]{display:none!important}` 全局兜底——别自己再写 `display` 去盖它。
7. 注释里的 "mock 为准"：指当初外部视觉基准（`comments.html`/`edit.html`，不在仓库里）。改样式只用 `globals.css` 现有 token，别加新 token。
8. 测试和生产不是一回事：测试跑 `:memory:` 库 + 全局 stub `fetch` + `SESSION_SECRET=test-secret`；生产是文件库 + 真 Discord。联调 Bot 必须起 dev 连真 key，单测过不代表卡能发出去。
