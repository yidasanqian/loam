# loam

**简体中文** · [English](README.en.md)

单人、多设备、多 harness（DSH / Claude Code / Codex）共享的**项目级长期记忆**。
一条命令接入，CLI + skill 调用，Cloudflare 免费层承载，不做 MCP。仓库内置一个同源**记忆工作台**（四泳道 + 原理图 + 中英双语界面）。

- 命令：`loam`　发布名：`@yidasanqian/loam`
- 后端：Workers + D1（Hono 路由，per-device Bearer，原生限流）
- 边界与取舍：见 [docs/SCOPE.md](docs/SCOPE.md) 与 [docs/DECISIONS/](docs/DECISIONS/)

## 为什么

多种 harness 各自有会话记忆，跨设备的项目上下文互不可见。loam 把「决策 / 坑 / 约定 / 事实」抽成一行文本 + 元数据，按 project 隔离、按 hash 幂等、按设备鉴权，任何一端写入，另一端开工前 `loam search` 即可命中。

```
harness (DSH / Claude Code / Codex)
   │  AGENTS.md 标记块 + SKILL.md
   ▼
loam CLI ──HTTPS/JSON──► Worker (Hono) ──► D1 (devices, facts)
   │                         └─ ratelimits binding
   ├─ ~/.loamrc.json        0600，server + device token
   ├─ ~/.loam/outbox.jsonl  断网写入
   ├─ ~/.loam/cache/        5 分钟读取缓存
   └─ ~/.loam/install.json  安装清单，供 doctor / uninstall
```

## 记忆模型

四类决定「这是什么」，三个属性决定「它现在还算不算数、排多前」：

| 维度 | 取值 | 作用 |
|---|---|---|
| `kind` | 决策 / 坑 / 约定 / 事实 | 页面上的四列；召回时的语义 |
| `pinned` | 0/1 | 常驻：注入与复盘优先，`prune` 不删 |
| `importance` | 1..5（默认 3） | 排序权重，写方给出 |
| `superseded_by` | 同 project 的新行 id | 事实级时态：旧条目退出默认召回，保留历史 |

- 排序 `sort=rank`：`pinned DESC, importance DESC, created_at DESC`，只出 top-N；分页仍按时间 keyset。
- 取代只能通过 `POST {supersedes}` 建立，PATCH 仅能取消，因此不会成环。
- 页面「原理」视图把这条链路画成一张图，并与代码逐项对应（见 [docs/UI.md](docs/UI.md)）。

## 快速开始（本地）

```bash
pnpm install
cd worker
cp .dev.vars.example .dev.vars            # 写入 ADMIN_TOKEN
pnpm dlx wrangler d1 execute loam --local --file=./schema.sql   # 全新库
# 已有 0.1 的库只跑迁移（不要再跑 schema.sql）：
# pnpm dlx wrangler d1 execute loam --local --file=./migrations/0002-memory-shape.sql
pnpm dev                                   # http://127.0.0.1:8787

# 另开终端
cd ../cli
pnpm build
LOAM_ADMIN_TOKEN=... node dist/bin.js login --server http://127.0.0.1:8787 --name win-desktop
node dist/bin.js add "D1 is the source of truth" --kind decision --importance 5
node dist/bin.js add "Use Hono plus D1" --kind decision --supersedes <旧条目 id>
node dist/bin.js search "source"
```

## 部署（Cloudflare）

```bash
cd worker
pnpm dlx wrangler d1 create loam           # 把 database_id 填进 wrangler.toml
# 二选一：全新库跑 schema.sql；已有 0.1 的库只跑迁移。
pnpm dlx wrangler d1 execute loam --file=./schema.sql --remote
# pnpm dlx wrangler d1 execute loam --file=./migrations/0002-memory-shape.sql --remote
pnpm dlx wrangler secret put ADMIN_TOKEN   # 只在 /v1/activate 使用
pnpm deploy
```

`deploy` workflow 只**校验** schema（缺列直接失败），不会自动改库；迁移按上面的命令先手动执行。升级前先 `loam export --out backup.ndjson`，或 `wrangler d1 export loam --remote --output backup.sql`。

参考部署：`https://loam.sanqian.workers.dev`。`ADMIN_TOKEN` 只用于发放设备 token；设备拿到 `loam_<id8>_<32B>` 后独立鉴权，撤销单台不影响其它设备。

升级前先 `loam export --out backup.ndjson`。新列是纯增量的，旧代码忽略它们，回滚代码不需要回滚 schema。

`deploy` workflow 只校验 schema，不自动迁移：先跑 `worker/migrations/0002-memory-shape.sql --remote`，再 push 或手动触发 deploy。

中国大陆直连 `workers.dev` 可能超时（实测需代理）。登录时把代理写进配置，之后 CLI 自动使用（Node ≥24）：

```bash
loam login --server https://loam.sanqian.workers.dev --name win-desktop --proxy http://127.0.0.1:7890
loam search "keyword"
```

## 接入三端

```bash
loam install              # 探测 ~/.dsh、~/.claude、~/.codex，交互勾选
loam install --only codex --dry-run
loam install --with-hooks # 额外注册 Claude Code UserPromptSubmit hook（默认不装）
loam doctor               # token / skill / 标记块 / 最近 recall 自检
loam uninstall            # 按 install.json 精确回滚
```

`install` 只动两处：仓库 `AGENTS.md` 的 `<!-- loam:start -->…<!-- loam:end -->` 标记块，以及各 harness 的指令文件与 skill 目录；每次写入都记进 `~/.loam/install.json`。

升级 CLI 后要重新接线，否则本地 skill 仍是旧内容：

```bash
loam upgrade        # 查看 CLI / npm 最新 / 接线版本
npm i -g @yidasanqian/loam@latest
loam install        # 刷新 skill 与 AGENTS.md 块
loam doctor         # version 项会指出接线版本漂移
```

## CLI 一览

| 命令 | 作用 |
|---|---|
| `login --server URL --name NAME` | 注册/轮换本机 token，写入 `~/.loamrc.json` |
| `add "<text>" --kind … --importance 1..5 [--pin] [--supersedes id]` | 记录事实，`project + kind + text` 幂等 |
| `search "<关键词>" [--sort rank\|recent]` | 默认 5 条、≤6 行、每行 ≤100 字符；默认按常驻/热度排序 |
| `show <id\|前缀>` / `list` | 单条详情（含常驻/取代链）/ 最近 N 条 |
| `devices [list\|revoke\|rotate]` | 设备与 token 生命周期 |
| `upgrade` | 检查 npm 最新版与接线版本，给出升级/刷新命令 |
| `export` / `import` | NDJSON 备份与恢复（含 pinned/importance） |
| `flush` | 补发离线 outbox |
| `prune --older 180d` | 软删除过期事实（跳过常驻） |

完整参数、退出码与环境变量见 [docs/CLI.md](docs/CLI.md)。

## 记忆工作台

部署后打开 `https://loam.sanqian.workers.dev/`，粘贴 `~/.loamrc.json` 里的 token：

- **工作台**：决策 / 坑 / 约定 / 事实四列，各自滚动；整页不滚动。拖卡片到另一列即改类型。
- **检视抽屉**：全文、来源、常驻、重要度 1–5、取代状态、修订与删除（6 秒可撤销），不打断列表。
- **捕获条**：底部常驻，project 继承当前项目；从检视栏「标为过时」进入时预填 `supersedes`。
- **时间轴**：今天 / 近 7 天 / 近 30 天 / 更早，四段并列。
- **复盘**：一次一张，改类型 / 固定 / 修订 / 删除 / 跳过，适合一圈扫完。
- **原理**：一张记忆模型工作原理图（写入 → 形状 → 读取 → 维护），与代码逐项对应，并显示实时计数。
- **双语**：界面按浏览器语言自动选择中文或英文（`localStorage` → `navigator.languages` → `en`），顶栏可切换。

<details>
<summary>界面预览（3 张，点开）</summary>

**工作台 · 1440×900**

![loam 工作台：四泳道、卡片与底部捕获条](docs/images/loam-board.png)

**记忆模型原理图 · 1440×900**

![loam 记忆模型原理图：写入、形状、读取、维护](docs/images/loam-model.png)

**移动端 · 390×844**

![loam 移动端：单列横向 snap 与底部捕获](docs/images/loam-mobile.png)

</details>

页面由 Workers Assets 托管（`worker/public/`），同源调用 `/v1/*`；token 只存当前浏览器的 localStorage，CSP 禁止内联脚本/样式与外部资源。无构建链、无框架、无第三方前端依赖。

## 开发与验证

```bash
pnpm typecheck
pnpm -r test                     # worker: vitest 官方池；cli: node:test
pnpm --filter @loam/worker test:offline   # 零依赖：node:sqlite 跑真实 SQL
pnpm check:licenses              # 许可证白名单
```

离线套件不需要 workerd：`worker/test/offline` 用 `node:sqlite` 实现 D1 形状的 adapter，直接跑 schema、幂等、取代、rank 与软删除。

页面手测清单（10 项）见 [docs/UI.md](docs/UI.md)；本地样例数据用 `scripts/seed-dev.mjs`。

## 状态

| 阶段 | 状态 |
|---|---|
| M0 骨架 + 边界 + ADR | 完成 |
| M1 Worker + 鉴权 + facts CRUD + 限流 | 完成；HTTP 23/23 |
| M2 CLI MVP + outbox + 裁剪 | 完成；CLI 32/32 |
| M2.5 installer + doctor + uninstall | 完成 |
| M3 三端接线 / M4 双机验收 | 三端无头会话实测命中；第二台物理机未联调 |
| M5 CI / license / 发布 | `0.1.0`、`0.1.1`、`0.1.2` 已发布；CI + 自动部署 + 迁移防回归通过 |
| 记忆工作台 + 记忆形状（ADR-0006） | `0.1.2` 已发布；离线 17/17、HTTP 23/23、CLI 38/38 |

## GitHub CI/CD

- `push` / PR → `ci`：typecheck、Worker HTTP、CLI、offline、许可证、`wrangler deploy --dry-run`
- `push main`（`worker/**`）→ `deploy`：D1 schema → `wrangler deploy` → `/health` 冒烟；由仓库变量 `CF_DEPLOY=true` 开启
- `tag v*` → `release`：全量测试 → `pnpm build` → `npm publish --provenance --access public`

首次启用自动部署（仓库 secrets 只设一次）：

```bash
gh variable set CF_DEPLOY --body true
gh secret set CLOUDFLARE_ACCOUNT_ID --body "56cf8c921cb267fdae6d1f401bff12e2"
gh secret set CLOUDFLARE_API_TOKEN      # Workers Scripts:Edit + D1:Edit
```

发布走 **Trusted Publishing（OIDC）**，不需要 `NPM_TOKEN`。但包首次发布前 npm 侧还不存在条目，必须先手动发一次：

```bash
# 首次发布：一次性 Bypass-2FA Granular Access Token
# 1) npmjs.com/settings/yidasanqian/tokens → Generate New Token → Granular Access Token
#    ✔ Bypass two-factor authentication
#    Packages and scopes: All Packages · Read and write (publish and stage)
#    Expiration: 1 day
cd cli
npm config set //registry.npmjs.org/:_authToken=<token>
npm publish --access public
npm config delete //registry.npmjs.org/:_authToken
# 2) 发布成功后立即在 npm 删除该 token
```

> `cli/.npmrc` 与 `publishConfig.registry` 都固定到 `https://registry.npmjs.org/`。
>
> npm 要求「账号 2FA 或带 **Bypass 2FA** 的 Granular Token」二选一。实测 `npm login` 得到的 web token 即使加 `--otp` 仍返回 `E403`，所以首次发布直接用一次性 bypass token 最省事；若浏览器里的 2FA 能正常完成，也可以 `npm login && npm publish` 走 OTP。

然后配置 `npmjs.com/package/@yidasanqian/loam/settings → Trusted Publisher → GitHub Actions`：

| 字段 | 值 |
|---|---|
| Organization or user | `yidasanqian` |
| Repository | `loam` |
| Workflow filename | `release.yml` |
| Environment | 留空 |

之后打 tag 即自动发布，provenance 由 OIDC 生成：

```bash
git tag v0.1.0 && git push --tags
```

> 若 tag 发布在 `npm publish` 报 `404 Not Found - PUT https://registry.npmjs.org/@yidasanqian%2floam`，是 npm 侧 Trusted Publisher 未配置或与仓库 / workflow 不匹配，不是代码问题：先在 npm 包设置里配好 `release.yml`，再用新版本号重发。`0.1.1` 就是该情况下的手动 granular-token 发布（无 provenance）。
>
> `--provenance` 只支持 public 源仓库。仓库现为 public，后续 tag 发布会自动带 provenance；`0.1.1` / `0.1.2` 为手动发布（无 provenance）。若以后改回 private，workflow 会自动去掉 provenance。

`deploy` 用 `concurrency` 串行；`release` 依赖 npm provenance（`id-token: write`）。

## 文档

- [docs/SCOPE.md](docs/SCOPE.md) 范围内的能力与量化边界
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 组件、数据流、存储
- [docs/UI.md](docs/UI.md) 工作台版式、原理图与代码映射、手测清单
- [docs/AUTH.md](docs/AUTH.md) 设备 token、撤销、限流
- [docs/CLI.md](docs/CLI.md) 命令参考
- [docs/INSTALL.md](docs/INSTALL.md) 三端接线与回滚
- [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) 依赖与许可证策略
- [SECURITY.md](SECURITY.md) 明文边界与报告方式

Apache-2.0。计划原文见 [PLAN.md](PLAN.md)。