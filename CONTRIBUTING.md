# Contributing

## DCO

本项目使用 DCO，不设 CLA。每个 commit 加：

```
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` 会自动添加。

## 本地开发

```bash
pnpm install
pnpm typecheck
pnpm -r test
```

- Worker：`worker/`（Hono + D1）。`wrangler dev --local` 需要 `worker/.dev.vars`（从 `.dev.vars.example` 复制）与本地 schema：
  `pnpm dlx wrangler d1 execute loam --local --file=./schema.sql`
- CLI：`cli/`（commander）。源码直接用 Node 运行 TS（`node --experimental-strip-types`），构建 `pnpm build`（`tsc`）。
- Node 版本：CLI 需 ≥22.6；离线测试用 `node:sqlite`，需 Node ≥24（免 flag，CI 使用 24）。
- 测试：
  - `worker/test/offline`：零依赖，`node:sqlite` 跑真实 SQL。
  - `worker/test/http`：`@cloudflare/vitest-pool-workers`，验证 401/403/429 与双设备同步。
  - `cli/test/node`：纯逻辑 + 临时目录安装/回滚。

## 代码约定

- TypeScript strict，ESM；相对导入写 `.ts` 扩展名（`rewriteRelativeImportExtensions` 负责编译期改写）。
- 不用参数属性（`constructor(readonly x)`），源码保持 strip-only 可运行。
- 服务端热路径禁 `SELECT *`、禁 join、禁重计算；新查询必须命中索引。
- 错误统一 `{ error: { code, message } }`；CLI 错误用 `CliError(code, message, exitCode)`。
- 输出裁剪属于契约（≤6 行、≤100 字符），改动需同步 `docs/CLI.md` 与测试。

## 依赖

新增运行时依赖前先读 [ADR-0005](docs/DECISIONS/0005-dependency-policy.md)：更新 `docs/DEPENDENCIES.md` 的表格、说明替代方案，并跑 `pnpm check:licenses`。

## 决策

架构级改动先改/加 ADR（`docs/DECISIONS/NNNN-title.md`），格式：背景 / 决策 / 代价 / 替代 / 何时重审。

## 提交

- 一个 commit 一个最小功能单元；信息写「为什么」，不写「改了哪些文件」。
- 不提交 `~/.loamrc.json`、`.dev.vars`、outbox、缓存、`dist/`。
- 发布见下方「CI 与发布」，只走 OIDC，不使用也不保存 token。

## CI 与发布

- `push` / PR → `ci`：typecheck、Worker HTTP、CLI、offline、许可证、`wrangler deploy --dry-run`
- `push main`（`worker/**`）→ `deploy`：D1 schema 校验 → `wrangler deploy` → `/health` 冒烟
- `push main`（`worker/**`、`pages/**`）→ `pages`：构建 → Functions 打包 → 迁移 → `wrangler pages deploy` → `/health` 冒烟（`vars.CF_PAGES` 门控）
- `tag v*` → `release`：全量测试 → `pnpm build` → `npm publish --provenance --access public`

仓库变量与 secrets（只设一次）：

```bash
gh variable set CF_DEPLOY --body true
gh variable set LOAM_URL --body "https://你的-worker.workers.dev"   # 冒烟测试地址，不写进仓库
gh variable set CF_PAGES --body true                                # 启用 Pages 部署
gh variable set LOAM_PAGES_URL --body "https://你的项目.pages.dev"   # Pages 冒烟测试地址，可留空
gh secret set CLOUDFLARE_ACCOUNT_ID --body "..."
gh secret set CLOUDFLARE_API_TOKEN      # Workers Scripts:Edit + D1:Edit (+ Pages:Edit)
```

发布走 **Trusted Publishing（OIDC）**，不使用也不保存 `NPM_TOKEN`。npm 包设置里配置：

| 字段 | 值 |
|---|---|
| Organization or user | `yidasanqian` |
| Repository | `loam` |
| Workflow filename | `release.yml` |
| Environment | 留空 |

之后 `git tag v0.1.0 && git push --tags` 即自动发布。`--provenance` 只支持 public 源仓库；改回 private 时 workflow 会自动去掉 provenance。`LOAM_URL` 未配置时冒烟测试跳过。