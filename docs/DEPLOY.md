# Deploy

三种方式，任选其一。都需要一个 Cloudflare 账号，项目名默认 `loam`。

## 方式 A：一键部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yidasanqian/loam/tree/main/worker)

点按钮后，Cloudflare 会：

1. 把 `worker/` 复制到你自己的 GitHub 账号（该子目录作为新仓库根）。
2. 创建 Worker 与 D1，并把新的 `database_id` 写回你克隆里的 `wrangler.toml`。
3. 按 `worker/.dev.vars.example` 提示填 `ADMIN_TOKEN`。生成一个：

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

4. 跑 `worker/package.json` 的 `deploy` 脚本：先 `wrangler d1 execute DB --remote --file=./schema.sql -y` 建表，再 `wrangler deploy`。
5. 接上 Workers Builds：之后 push 到你复制出的仓库会自动构建部署。

部署完成后还有两步手动操作：

- 可选：绑定自定义域名。默认地址是 `https://<worker>.<你的子域>.workers.dev`。
- `loam login --server <地址> --name <设备名>`。

限制（来自 Cloudflare 的按钮机制）：

- 只支持公开的 github.com / gitlab.com 仓库。
- 一个按钮对应一个 Worker。
- 子目录必须自包含：`worker/` 有自己的 `package.json` 与 `wrangler.toml`，不依赖 workspace。

## 方式 B：命令行

```bash
cd worker
pnpm dlx wrangler d1 create loam           # 把 database_id 填进 wrangler.toml
pnpm dlx wrangler d1 execute loam --file=./schema.sql --remote   # 全新库
pnpm dlx wrangler secret put ADMIN_TOKEN   # 只在 /v1/activate 使用
pnpm run deploy                            # 建表（幂等）+ 部署
```

已有 0.1 的库不要重跑 `schema.sql`，只跑迁移：

```bash
pnpm dlx wrangler d1 execute loam --file=./migrations/0002-memory-shape.sql --remote
```

注意：

- `deploy` workflow 只**校验** schema（缺列直接失败），不会自动改库；迁移先手动执行。
- `pnpm run deploy` 会再跑一次 `schema.sql`，它是 `IF NOT EXISTS`，可重复执行。
- `ADMIN_TOKEN` 只用于发放设备 token；设备拿到 `loam_<id8>_<32B>` 后独立鉴权，撤销单台不影响其它设备。

## 方式 C：Cloudflare Pages（Functions + D1）

同一份 Hono 应用跑在 Pages Functions 上，工作台静态页由 Pages 同源托管。适合已经在用 Pages，或想让工作台和 API 挂在同一个 `*.pages.dev` / 自定义域名下的场景。

### 面板：连接 Git（按钮直达）

[![Deploy to Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare_Pages-F6821F?style=for-the-badge)](https://dash.cloudflare.com/?to=/:account/workers-and-pages)

Cloudflare 的 Deploy 按钮只支持 Workers 应用（[官方限制](https://developers.cloudflare.com/workers/platform/deploy-buttons/)），Pages 没有等价按钮：上面的按钮直达 Workers & Pages 面板，走 `Create application → Pages → Connect to Git` 选本仓库，然后填三项。

| 面板字段 | 值 | 原因 |
|---|---|---|
| Root directory | `pages` | `functions/` 与 `wrangler.toml` 都在 `pages/` 下，Pages 只认 Root directory 里的 Functions |
| Build command | `node ../scripts/build-pages.mjs` | 脚本用 `import.meta.dirname` 定位仓库根，与执行目录无关（需 Node ≥20.11，默认构建镜像已满足） |
| Build output directory | `public` | 与 `pages/wrangler.toml` 的 `pages_build_output_dir` 一致 |

项目名保持 `loam`（或同步改 `pages/wrangler.toml` 的 `name`），否则 `wrangler pages deploy` 会指向另一个项目。`DB` 绑定由 `pages/wrangler.toml` 提供；首次注册前在 Settings → Variables and Secrets 加 `ADMIN_TOKEN`。

### 命令行

```bash
# 库：已有 Worker 库就跳过，直接复用同一个 database_id
pnpm dlx wrangler d1 create loam
# 把打印出的 database_id 填进 pages/wrangler.toml

# 全新库建表（已有库只跑迁移）；Pages 项目与密钥只配一次
cd pages
pnpm dlx wrangler d1 execute loam --file=../worker/schema.sql --remote
pnpm dlx wrangler pages project create loam --production-branch main
pnpm dlx wrangler pages secret put ADMIN_TOKEN
cd ..

# 每次部署：在仓库根执行，先重建 pages/public 再上传
pnpm pages:deploy
```

文件分工：

- `pages/wrangler.toml`：Pages 专用配置（`pages_build_output_dir`、`DB` 绑定）。wrangler 不允许 `main` 与 `pages_build_output_dir` 同文件，所以它必须独立于 `worker/wrangler.toml`。
- `pages/functions/[[path]].ts`：把 `worker/src/index.ts` 的 Hono app 接到 Pages，约 10 行，没有第二份路由实现。
- `pages/public/`：`worker/public` 的副本，由 `scripts/build-pages.mjs` 生成（已 gitignore），并多一个 `_routes.json`——只有 `/v1/*` 与 `/health` 进 Functions，其余走静态资源。**新增非 `/v1` 前缀端点时必须同步这个 include 列表**，否则静态页会被 Functions 吞掉、返回 JSON 404。
- 页面与 API 同源，`_headers` 里的 CSP（`connect-src 'self'`）不用改，也不需要 CORS。

限制（Pages 与 Workers 的差异）：

- Pages 不支持 `[[ratelimits]]` 绑定：429 由 `rate.ts` 的进程内兜底提供，只在单个 isolate 内有效，强度低于 Workers 原生限流（见 [AUTH.md](AUTH.md#限流)）。
- 没有 `[observability]`，日志看 Pages 项目详情；自定义域名、预览分支仍在 Dashboard 配。
- 本地联调用 `wrangler pages dev`，它的 D1 状态在 `pages/.wrangler`，与 `worker/.wrangler` 不共享，需要单独 `--local` 建表。

## 升级与备份

升级前先导出：

```bash
loam export --out backup.ndjson
# 或
wrangler d1 export loam --remote --output backup.sql
```

新列是纯增量的，旧代码忽略它们，回滚代码不需要回滚 schema。迁移清单见 [DECISIONS/0007-migrations.md](DECISIONS/0007-migrations.md)。

## 代理（中国大陆）

直连 `workers.dev` 可能超时。登录时把代理写进配置，之后 CLI 自动使用（Node ≥24）：

```bash
loam login --server https://loam.example.workers.dev --name win-desktop --proxy http://127.0.0.1:7890
```

## CI / 自动发布

仓库自带的 `deploy` / `release` workflow、Trusted Publisher 配置与 tag 发布流程见 [CONTRIBUTING.md](../CONTRIBUTING.md#ci-与发布)。