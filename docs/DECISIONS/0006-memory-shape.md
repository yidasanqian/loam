# 0006 记忆形状：pinned / importance / superseded_by

## 背景

loam 的四类（决策 / 坑 / 约定 / 事实）只回答「这是什么」，不回答「它现在还算数吗、有多重要、是否该常驻」。现有接口按时间倒序返回，召回时旧决定与已推翻的决定混在一起；`inject` 也只能注入最新的三条。

## 决策

在 `facts` 上加三个正交属性，不改四类分类轴：

- `pinned`（常驻）：注入与复盘优先，`prune` 跳过；每 project 建议 ≤8 条。
- `importance`（1..5）：写方给出的排序权重，默认 3。
- `superseded_by` / `superseded_at`（取代）：事实级时态，默认召回过滤；只能通过 `POST {supersedes}` 建立，PATCH 仅能置空。

排序 `rank` = `pinned DESC, importance DESC, created_at DESC`，仅用于 top-N；分页仍走 `created_at` keyset。

## 代价

- 三个概念要教给使用方（CLI skill、页面图例）。
- 取代不能成环的约束依赖「只能新建、不能改指」，链查看只显示最近一跳。
- 多一次索引（`facts_project_rank`）与一个携带式迁移文件。

## 替代

- Mem0 式服务端抽取/更新：违反 ADR-0003（服务端不跑 LLM，10ms CPU）。
- Graphiti 式实体/时态图：复杂度与免费层预算都不合；事实级取代已覆盖单人需求。
- 读路径访问计数（MemoryOS 热度）：撞 D1 行写配额，`last_seen` 已因同因节流。

## 何时重审

常驻条数长期触顶、或 rank 试运行后召回质量没有变化 → 重审 pinned 与 importance 是否合并；出现跨项目共享需求 → 重审 project 隔离边界。