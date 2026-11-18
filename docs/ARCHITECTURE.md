# Architecture

## 组件

| 组件 | 位置 | 职责 |
|---|---|---|
| Worker API | `worker/src/index.ts` | Hono 路由、鉴权中间件、限流、错误映射 |
| 管理页 | `worker/public/`（Workers Assets） | 单页工作台：token 门禁、四泳道、检视抽屉、捕获、搜索、时间轴、复盘、原理图、设备撤销；界面中英双语 |
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
CLI: URLSearchParams(project|all, kind, tag, q, sort=rank|recent, pinned, limit≤5, cursor)
  → GET /v1/facts
      → WHERE deleted_at IS NULL AND project=?
              AND superseded_by IS NULL          -- unless include_superseded=1
              AND pinned = 1                     -- when pinned=1
              AND kind/tag/q …                   -- q: ≤5 terms, AND, substring
      → sort=rank:    ORDER BY pinned DESC, importance DESC, created_at DESC, id DESC LIMIT n
      → sort=recent:  ORDER BY created_at DESC, id DESC LIMIT n+1（keyset，不用 OFFSET）
      → rank 不返回 next（有序值无法用 (created_at,id) keyset 续页；带 cursor 返回 400）
  ← { facts[], next }
失败且允许缓存 ⇒ 读 ~/.loam/cache/search-*.json，stderr 标注离线
```

### add（含取代）

```
CLI/页面: 先解析 supersedes 目标（同 project、未删除、未被取代）
  → 查 hash 是否已存在
      已存在 ⇒ 复用原行 id（必要则 revive），deduped=true
      不存在 ⇒ crypto.randomUUID()
  → db.batch([INSERT … ON CONFLICT DO NOTHING, UPDATE 旧行 SET superseded_by=新 id, superseded_at])
      两条语句原子提交：不会出现「新条目落了、旧条目还活着」
  ← { fact, deduped, projectCount, warning, supersededTarget }
```

删除一条「被取代目标」时，同批次把指向它的 `superseded_by` 清空，避免其它行被永久隐藏。

## 管理页

`GET /` 由 Workers Assets 直接返回 `worker/public/index.html`，与 API 同源；token 存浏览器 localStorage。
前端无构建链、无框架、无第三方依赖：`app.js`（状态/路由/请求）、`views.js`（泳道/卡片/检视/时间轴/复盘/原理图）、`overlays.js`（搜索与设备弹窗）、`i18n.js`（语言协商与文案）。

- 版式：`body` 固定 `100dvh`；四泳道各自滚动，整页不滚动。窄屏改为横向 snap 与底部 tab 形态（同一份 CSS 断点）。
- 视图：`#/b|t|r|m/<project>` + `?id=<id8>`，hash 是唯一真源；刷新与后退都走同一解析路径。
- 原理图：内联 SVG（`viewBox 1000×560`），文案节点带 `data-i18n`，图下实时计数来自 `/v1/stats`；图与代码的对应表见 [UI.md](UI.md)。
- i18n：`localStorage.loam.lang` → `navigator.languages`（RFC 4647 主语言匹配）→ `en`；日期用 `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat`。
- 端点：`GET /v1/projects`（project 聚合）、`GET /v1/stats`（byKind / activeByKind / pinned / superseded）、`PATCH /v1/facts/:id`（text/kind/tags/pinned/importance/取消取代）。
- CSP 由 `public/_headers` 下发（`default-src 'self'`，无 inline script/style/外部资源）；用户内容一律 `textContent`，动态样式只用 CSSOM 或类名。

## 存储

```sql
devices(id PK, name, token_hash UNIQUE, scopes, created_at, last_seen_at, revoked_at)
facts(id PK, project, kind, text, hash, tags, harness,
      pinned DEFAULT 0, importance DEFAULT 3, superseded_by, superseded_at,
      device_id, device_name, created_at, deleted_at)
UNIQUE(project, hash)                       -- 幂等
INDEX(project, created_at DESC)             -- 项目内检索
INDEX(project, pinned DESC, importance DESC, created_at DESC)  -- rank
INDEX(superseded_by)                        -- 删除目标时清指针
INDEX(created_at DESC)                      -- export / --all
```

- `schema.sql` 只用于全新库；已有库的升级走 `worker/migrations/NNNN-*.sql`（有序、只增列/加索引）。deploy 前 `scripts/check-d1-schema.mjs` 从迁移文件提取 `ADD COLUMN` 并对线上 `pragma_table_info` 校验；离线 `migrations.test.ts` 断言 0.1 + 迁移与全新 schema 的列、索引一致。
- 事实为软删除（`deleted_at`），保证 hash 去重不会因删后重写产生歧义；`prune` 只是批量置位，且跳过 `pinned=1`。
- 取代是事实级时态：`superseded_by` 指向同 project 的新行，默认召回过滤 `superseded_by IS NULL`；被取代时同批次清掉 `pinned`（退出的规则不该继续占用常驻位）。PATCH 只能置空（解除取代），建立取代必须走 `POST {supersedes}`，因此不会出现环。
- `importance` 只由写入方给出（1..5），服务端不推测；新列不加 SQL CHECK（SQLite 无法给已存在列加约束），范围校验集中在 `validate.ts`。
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
- 不做 CRDT/时钟排序：`created_at` 只是写入时间，检索排序用 `(created_at, id)` 或 `(pinned, importance, created_at)`。
- 冲突处理即「都保留」；语义冲突（旧决定被推翻）用 `supersedes` 显式表达，而不是删改历史。
- 取代与删除都走 `db.batch`：要么两条语句一起生效，要么都不生效。

## 测试分层

| 层 | 位置 | 依赖 | 覆盖 |
|---|---|---|---|
| 核心 SQL / 幂等 / 分页 / 撤销 | `worker/test/offline`（node:test + node:sqlite） | 无 | schema、明文 SQL、边界 |
| HTTP / 鉴权 / scopes / 同步 | `worker/test/http`（vitest + `@cloudflare/vitest-pool-workers`） | workerd | 401/403/429、A↔B、并发同事实、记忆形状（supersede/pinned/importance/stats） |
| CLI 纯逻辑 | `cli/test/node`（node:test） | 无 | 输出裁剪、marker 块、outbox 状态机 |
| 安装 / 回滚 | `cli/test/node/install.test.ts` | 临时目录 | 全装 / 单装 / 重装 / 卸载 |

## 相关决策

[0001-no-mcp](DECISIONS/0001-no-mcp.md) · [0002-cloudflare-only](DECISIONS/0002-cloudflare-only.md) · [0003-client-side-extraction](DECISIONS/0003-client-side-extraction.md) · [0004-bearer-not-oauth](DECISIONS/0004-bearer-not-oauth.md) · [0005-dependency-policy](DECISIONS/0005-dependency-policy.md) · [0006-memory-shape](DECISIONS/0006-memory-shape.md)