# Architecture

## 组件

| 组件 | 位置 | 职责 |
|---|---|---|
| Worker API | `worker/src/index.ts` | Hono 路由、鉴权中间件、限流、错误映射 |
| 管理页 | `worker/public/`（Workers Assets） | 单页 UI：token 门禁、筛选、增改删、导出、设备撤销 |
| 核心逻辑 | `worker/src/facts.ts` / `devices.ts` / `validate.ts` / `auth.ts` / `rate.ts` | 纯函数 + SQL，不依赖 Hono，可脱离 workerd 测试 |
| 存储 | `worker/schema.sql`（D1） | `devices`、`facts` 两表；软删除 |
| CLI | `cli/src/` | 命令、配置、outbox、缓存、输出裁剪、installer |
| Skill | `cli/skills/SKILL.md` | 调用约定（≤2 次 search、只写可复用事实） |
| 安装产物 | 仓库 `AGENTS.md`、`~/.claude/CLAUDE.md`、`~/.codex/AGENTS.md`、`~/.dsh/AGENTS.md`、`*/skills/loam/SKILL.md` | 标记块与 skill |

## 数据流

### add

```
CLI: detect project / kind / text / harness
  → POST /v1/facts
      → SHA-256(project ␀ kind ␀ normalized text)
      → INSERT … ON CONFLICT(project, hash) DO NOTHING
      → changes=0 ⇒ deduped=true，读回既有行
      → COUNT(project) 超过 20k ⇒ warning
  ← { fact, deduped, projectCount, warning }
网络失败 ⇒ 落 ~/.loam/outbox.jsonl，loam flush 重放（服务端幂等）
```

### search

```
CLI: URLSearchParams(project|all, kind, tag, q, limit≤5, cursor)
  → GET /v1/facts
      → WHERE deleted_at IS NULL AND project=? …
      → ORDER BY created_at DESC, id DESC LIMIT limit+1
      → next = created_at + '_' + id（keyset，不用 OFFSET）
  ← { facts[], next }
失败且允许缓存 ⇒ 读 ~/.loam/cache/search-*.json，stderr 标注离线
```

## 管理页

`GET /` 由 Workers Assets 直接返回 `worker/public/index.html`，与 API 同源；token 存浏览器 localStorage。
新增端点：`GET /v1/projects`（按 project 聚合计数）、`PATCH /v1/facts/:id`（改 text/kind/tags、重算 hash、冲突 409）。
CSP 由 `public/_headers` 下发（`default-src 'self'`，无 inline script/style），前端全部用 `textContent` 渲染用户内容。

## 存储

```sql
devices(id PK, name, token_hash UNIQUE, scopes, created_at, last_seen_at, revoked_at)
facts(id PK, project, kind, text, hash, tags, harness,
      device_id, device_name, created_at, deleted_at)
UNIQUE(project, hash)                       -- 幂等
INDEX(project, created_at DESC)             -- 项目内检索
INDEX(created_at DESC)                      -- export / --all
```

- 事实为软删除（`deleted_at`），保证 hash 去重不会因删后重写产生歧义；`prune` 只是批量置位。
- `device_name` 冗余在 facts 行内：provenance 是写入时的快照，读路径不 join。
- 只查需要的列，禁止 `SELECT *`；`COUNT(*)` 仅按 project 索引过滤。

## 请求生命周期（读）

1. `parseBearer` → 格式检查（不打库）。
2. `SELECT … FROM devices WHERE token_hash = ?`（唯一索引，SHA-256 十六进制）。
3. 已撤销 → 401；限流 `RL_API`（60/min/设备）→ 429。
4. `last_seen_at` 节流写：5 分钟内只写一次。
5. 业务 SQL 1–2 条。
6. JSON 响应，错误统一 `{ error: { code, message } }`。

CPU 预算：无 JSON 遍历、无正则重活、无跨表 join；热路径最多 2 条 D1 查询 + 1 条条件更新。

## 部署拓扑

```
Cloudflare 免费层
  Workers (loam) ── D1(loam) ── (可选) R2 / Vectorize v1.1
      ├─ secret ADMIN_TOKEN（只给 /v1/activate）
      └─ ratelimits binding：RL_AUTH 10/min/IP，RL_API 60/min/设备
本地环境
  wrangler dev --local + D1 local SQLite + in-memory 限流兜底
```

## 一致性与冲突

- 单人假设：同 project 并发写不同事实直接落库；同一事实由唯一索引收敛，后到者 `deduped=true`。
- 不做 CRDT/时钟排序：`created_at` 只是写入时间，检索排序用 `(created_at, id)`。
- 冲突处理即「都保留」；错误语义由用户 `show` / `prune` 决定。

## 测试分层

| 层 | 位置 | 依赖 | 覆盖 |
|---|---|---|---|
| 核心 SQL / 幂等 / 分页 / 撤销 | `worker/test/offline`（node:test + node:sqlite） | 无 | schema、明文 SQL、边界 |
| HTTP / 鉴权 / scopes / 同步 | `worker/test/http`（vitest + `@cloudflare/vitest-pool-workers`） | workerd | 401/403/429、A↔B、并发同事实 |
| CLI 纯逻辑 | `cli/test/node`（node:test） | 无 | 输出裁剪、marker 块、outbox 状态机 |
| 安装 / 回滚 | `cli/test/node/install.test.ts` | 临时目录 | 全装 / 单装 / 重装 / 卸载 |

## 相关决策

[0001-no-mcp](DECISIONS/0001-no-mcp.md) · [0002-cloudflare-only](DECISIONS/0002-cloudflare-only.md) · [0003-client-side-extraction](DECISIONS/0003-client-side-extraction.md) · [0004-bearer-not-oauth](DECISIONS/0004-bearer-not-oauth.md) · [0005-dependency-policy](DECISIONS/0005-dependency-policy.md)