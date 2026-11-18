# 记忆工作台（UI）

静态单页，无构建链、无框架、无第三方依赖；由 Workers Assets 托管在 `worker/public/`。

```
index.html  # 骨架、SVG 原理图、模板、对话框
styles.css  # 版式、密度、断点、动效
app.js      # 状态 / 路由 / 请求 / 捕获 / 检视动作 / 语言切换
views.js    # 四泳道 / 卡片 / 时间轴 / 复盘 / 检视栏填充 / 原理图计数
overlays.js # 搜索面板、设备弹窗
i18n.js     # 语言协商、文案、Intl 日期与相对时间
```

## 版式

```
┌───────────────────────────────────────────────────────────────────────┐
│ loam  项目 ▾        [工作台 │ 时间轴 │ 复盘 │ 原理]   [搜索] 中 ⚙ ⤓ ⏻ │
├───────────────────────────────────────────────────────────────────────┤
│ ★ 常驻  [条目] [条目] [条目]                                          │
├───────────────────────────────────────────────────────────────────────┤
│ 决策 N        │ 坑 N          │ 约定 N        │ 事实 N                 │
│ 卡片（独立滚动）│ 卡片          │ 卡片          │ 卡片                   │
├───────────────────────────────────────────────────────────────────────┤
│ [ 记一条… ]  [决策|坑|约定|事实]  标签  project                    [记录] │
└───────────────────────────────────────────────────────────────────────┘
```

- `body` 固定 `100dvh`，整页不滚动；滚动只发生在泳道、检视栏、原理视图内部。
- 四类就是四列：分类是版式，不是筛选器。
- 检视栏是非 modal `dialog`（`show()`），不遮住整页、不抢焦点，关闭后卡片保持原位。
- 删除不弹确认，改为 6 秒可撤销的 toast（重新写入同文本即 revive）。
- 捕获框继承当前 project；从检视栏「标为过时」进入时预填 `supersedes`。

## 视图与路由

| 视图 | 路由 | 数据 |
|---|---|---|
| 工作台 | `#/b/<project>` | `/v1/stats` + 四条 `kind` 查询（`sort=recent`，30/页）+ `pinned=1` |
| 时间轴 | `#/t/<project>` | 最近 50 条，客户端分桶：今天 / 近 7 天 / 近 30 天 / 更早 |
| 复盘 | `#/r/<project>` | `sort=rank&limit=50`，一次一张；已处理只记在本次会话 |
| 原理 | `#/m/<project>` | `/v1/stats` 实时计数 |

`?id=<id8>` 表示当前打开的条目；hash 是唯一真源，刷新与后退都走同一解析路径。

## 原理图（记忆模型）

内联 SVG，`viewBox 0 0 1000 560`，四段：写入 → 记忆的形状 → 读取 → 维护。图下是 4 类语义卡片、3 个属性说明与一行实时计数。实时计数取 `activeByKind`（可召回数，不含已取代），与泳道头一致；已取代单独列出。

图上的每个机制都能在代码里指到位置：

| 图上机制 | 代码 |
|---|---|
| 哈希去重 | `worker/src/facts.ts` `factHash` + `worker/schema.sql` `UNIQUE(project, hash)` |
| 常驻优先 | `searchFacts` 的 `ORDER BY pinned DESC` + `cli/src/bin.ts` `inject`（`sort=rank`） |
| 热度排序 | 同上：`importance DESC` |
| 取代时态 | `POST /v1/facts {supersedes}`、默认过滤 `superseded_by IS NULL`、删除目标时清指针 |
| 输出裁剪 | `cli/src/format.ts` `MAX_LINE=100`、`MAX_SEARCH_LINES=6` |
| 离线重放 | `cli/src/outbox.ts` + `loam flush` |

改模型时同步改图；`docs/UI.md` 的映射表是验收项，不是装饰。

## i18n

- 顺序：`localStorage.loam.lang`（用户显式选择）→ `navigator.languages` 里第一个支持的主语言（RFC 4647 lookup）→ `en`。
- 支持的界面语言：`zh`、`en`；顶栏按钮切换并持久化，切换时同步 `<html lang>`。
- 文案表在 `i18n.js`（key → `[zh, en]`）；`data-i18n*` 节点由 `applyTranslations()` 批量填充，模板里先写中文作为无 JS 兜底。
- 日期与相对时间用 `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat`，跟随浏览器时区。
- 只翻译界面：记忆内容保持写入时的语言；服务端不参与 i18n。

## 断点

| 宽度 | 行为 |
|---|---|
| ≥ 1400 | 四列等分；检视抽屉覆盖右侧，打开不重排 |
| 1100–1399 | 泳道 `minmax(250px, 1fr)`，容器横向滚动 |
| ≤ 980 | 顶部换行；泳道变为横向 snap（每列 86% 宽，列内滚动）；抽屉全屏 |
| ≤ 900 | 同上；原理图容器横向滚动，不缩字 |

## 可访问性

- 泳道 `<section>` + 标题；卡片 `tabindex=0`（Enter/Space 打开，原生焦点行为，不是快捷键系统）。
- 搜索面板 `showModal()` + `aria-activedescendant`；toast `aria-live=polite`。
- 语言切换更新 `document.documentElement.lang` 与 `document.title`。
- `prefers-reduced-motion` 关闭动画。

## 手测清单（改版前后各跑一遍）

1. 1440×900：`document.scrollingElement.scrollHeight <= innerHeight + 1`。
2. 390×844：无横向溢出；四列可横向 snap。
3. 四泳道独立滚动；切换项目后计数与列表同步刷新。
4. 点卡片开抽屉；关闭后列表仍在原位（不重排、页面不滚动）。
5. 拖卡片到另一列，kind 改变、两列计数变化、刷新后保持。
6. 删除 → toast 撤销 → 条目恢复（同 id）。
7. 搜索面板输入关键词，点结果打开详情；被取代条目显示「已取代」。
8. 原理视图两种尺寸完整可读；图上计数与 `/v1/stats` 完全一致。
9. 中文浏览器默认中文；切到 EN 后刷新仍为 EN；`<html lang>` 正确。
10. console 无 CSP violation；401 回 token 门禁；429 提示不自动重试。

## 本地查看

```bash
cd worker
pnpm dlx wrangler d1 execute loam --local --file=./schema.sql          # 全新库
# 已有 0.1 的库只跑迁移：pnpm dlx wrangler d1 execute loam --local --file=./migrations/0002-memory-shape.sql
pnpm dev                                    # http://127.0.0.1:8787
node ../scripts/seed-dev.mjs --server http://127.0.0.1:8787 --token <device token>
```

`seed-dev.mjs` 只用于本地样例（3 个项目 × 4 类 × 48 条），不要指向线上库。