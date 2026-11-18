# loam

单人、多设备、多 harness（DSH / Claude Code / Codex）共享的**项目级长期记忆**。
一条命令接入，CLI + skill 调用，Cloudflare 免费层承载，不做 MCP。

- 命令：`loam`　发布名：`@loam/cli`（`loam` 已被 GDAL wrapper 占用，2026-11-17 核验；`@loam/cli` / `@loam/worker` 在 npm 上均为 404）
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

## 快速开始（本地）

```bash
pnpm install
cd worker
cp .dev.vars.example .dev.vars            # 写入 ADMIN_TOKEN
pnpm dlx wrangler d1 execute loam --local --file=./schema.sql
pnpm dev                                   # http://127.0.0.1:8787

# 另开终端
cd ../cli
pnpm build
LOAM_ADMIN_TOKEN=... node dist/bin.js login --server http://127.0.0.1:8787 --name win-desktop
node dist/bin.js add "D1 is the source of truth" --kind decision
node dist/bin.js search "source"
```

## 部署（Cloudflare）

```bash
cd worker
pnpm dlx wrangler d1 create loam           # 把 database_id 填进 wrangler.toml
pnpm dlx wrangler d1 execute loam --file=./schema.sql --remote
pnpm dlx wrangler secret put ADMIN_TOKEN   # 只在 /v1/activate 使用
pnpm deploy
```

参考部署：`https://loam.sanqian.workers.dev`（WNAM）。`ADMIN_TOKEN` 只用于发放设备 token；设备拿到 `loam_<id8>_<32B>` 后独立鉴权，撤销单台不影响其它设备。

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

## CLI 一览

| 命令 | 作用 |
|---|---|
| `login --server URL --name NAME` | 注册/轮换本机 token，写入 `~/.loamrc.json` |
| `add "<text>" --kind …` | 记录事实，`project + kind + text` 幂等 |
| `search "<关键词>"` | 默认 5 条、≤6 行、每行 ≤100 字符 |
| `show <id\|前缀>` / `list` | 单条详情 / 最近 N 条 |
| `devices [list\|revoke\|rotate]` | 设备与 token 生命周期 |
| `export` / `import` | NDJSON 备份与恢复 |
| `flush` | 补发离线 outbox |
| `prune --older 180d` | 软删除过期事实 |

完整参数、退出码与环境变量见 [docs/CLI.md](docs/CLI.md)。

## 记忆管理页

部署后打开 `https://loam.sanqian.workers.dev/`，粘贴 `~/.loamrc.json` 里的 token：

- 项目 / 类型 / 标签筛选，多词 AND 搜索
- 直接记录、修订、软删除，一键导出 NDJSON
- 设备列表与撤销（撤销当前设备会立即退出登录）

页面由 Workers Assets 托管（`worker/public/`），同源调用 `/v1/*`；token 只存当前浏览器的 localStorage，CSP 禁止内联脚本与外部资源。

## 开发与验证

```bash
pnpm typecheck
pnpm -r test                     # worker: vitest 官方池；cli: node:test
pnpm --filter @loam/worker test:offline   # 零依赖：node:sqlite 跑真实 SQL
pnpm check:licenses              # 许可证白名单
```

离线套件不需要 workerd：`worker/test/offline` 用 `node:sqlite` 实现 D1 形状的 adapter，直接跑 schema、幂等、keyset 分页与软删除。

## 状态

| 阶段 | 状态 |
|---|---|
| M0 骨架 + 边界 + 5 条 ADR | 完成；名字核验：`loam` 已占，`@loam/cli` 可用 |
| M1 Worker + 鉴权 + facts CRUD + 限流 | 完成；vitest 官方池 17/17（401/403/429 路径、A↔B、边界、分页） |
| M2 CLI MVP + outbox + 裁剪 | 完成；CLI 30/30；真机 login/add/search/flush/revoke 全通，search 6 行 / 80 字符上限实测 |
| M2.5 installer + doctor + uninstall | 完成；安装/重装幂等/卸载回滚套件通过，真机 dry-run 探测三端正确 |
| M3 三端接线 / M4 双机验收 | 三端无头会话实测命中（DSH 本会话、`claude -p`、`codex exec`，provenance 正确）；第二台物理机未联调 |
| M5 CI / license 检查 / 发布 | CI（frozen lockfile）+ 许可证白名单 + `wrangler deploy --dry-run` 通过；发布待 npm token |

验证命令与结果见下节；实测环境：Node 24.19、pnpm 11.28、wrangler 4.162、Windows 11。

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
cd cli && npm login && npm publish --access public   # 仅首次；需先在 npm 启用 2FA（会提示 OTP）
```

> `cli/.npmrc` 与 `publishConfig.registry` 都固定到 `https://registry.npmjs.org/`。若在仓库根目录执行 `npm login`，记得加 `--registry=https://registry.npmjs.org/`，否则会打开 npmmirror 的登录页。
>
> 若报 `E403 … Two-factor authentication or granular access token with bypass 2fa enabled`：这是 npm 要求发布者**必须启用 2FA**（未开启会拒绝发布）。先在 npm → Account Settings → Two-Factor Authentication 启用 TOTP 或 Passkey，保存恢复码，再发布；之后可用带 **Bypass 2FA** 的 Granular Access Token 在 CI/本地免 OTP。首次发布成功后配置 Trusted Publisher，之后 tag 发布走 OIDC，不再需要 token 或 OTP。

然后配置 `npmjs.com/package/@loam/cli/settings → Trusted Publisher → GitHub Actions`：

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

`deploy` 用 `concurrency` 串行；`release` 依赖 npm provenance（`id-token: write`）。

## 文档

- [docs/SCOPE.md](docs/SCOPE.md) 范围内的能力与量化边界
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 组件、数据流、存储
- [docs/AUTH.md](docs/AUTH.md) 设备 token、撤销、限流
- [docs/CLI.md](docs/CLI.md) 命令参考
- [docs/INSTALL.md](docs/INSTALL.md) 三端接线与回滚
- [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) 依赖与许可证策略
- [SECURITY.md](SECURITY.md) 明文边界与报告方式

Apache-2.0。计划原文见 [PLAN.md](PLAN.md)。