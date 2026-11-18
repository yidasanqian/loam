# Deploy

两种方式，任选其一。都需要一个 Cloudflare 账号，Worker 名默认 `loam`。

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