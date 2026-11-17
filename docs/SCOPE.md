# Scope（v1）

- 一句话：单人、2+ 设备、3+ harness 共享**同一项目**的长期记忆。
- 真相源：Workers + D1；无第二后端。
- 载体：CLI + skill，不做 MCP（ADR-0001）。

## 范围内的能力

| 能力 | v1 实现 |
|---|---|
| 事实模型 | `project` + `kind(decision\|pitfall\|convention\|fact)` + `text` + `tags` + provenance（harness / device / time） |
| 写入幂等 | `sha256(project ␀ kind ␀ normalized text)` + `UNIQUE(project, hash)` |
| 离线 | CLI outbox（`~/.loam/outbox.jsonl`），`loam flush` 补齐；服务端幂等兜底 |
| 检索 | project 隔离、`kind`/`tag`/`q` 过滤、keyset 分页；默认 5 条 |
| 设备与鉴权 | per-device Bearer、scopes(read/write)、撤销、轮换、限流 |
| 安装 | `loam install` 探测三端 → 标记块 + skill 文件 + 可选 hook；`doctor` / `uninstall` |
| 运维 | `export` / `import` / `prune` / `devices` |
| 文档 | SCOPE / ARCHITECTURE / AUTH / CLI / INSTALL / DEPENDENCIES + 5 条 ADR |

## 量化边界（代码断言）

| 项 | 上限 | 位置 |
|---|---|---|
| 单条文本 | 4 KB（UTF-8，超限 413） | `worker/src/validate.ts` `MAX_TEXT_BYTES` |
| project 名 | 128 字符，`A-Za-z0-9._@:/-` | `validateProject` |
| 单 project | 20k 条，超过写入返回 `warning` | `MAX_PROJECT_FACTS` |
| tags | 8 个 × 32 字符 | `validateTags` |
| search 默认 | 5 条 × ≤100 字符 ≤6 行 | `cli/src/format.ts` + `cli/src/bin.ts` |
| 单任务 search | ≤ 2 次（skill 约束；不阻断调用） | `cli/skills/SKILL.md` |
| hook 注入 | ≤3 条 / 每条 ≤60 字符 / 总计 ≤800 字符 | `loam inject` |
| Worker CPU | 目标 ≤10 ms（无重计算、无 SELECT *） | 下沉 SQL，见 ARCHITECTURE |
| Vectorize（v1.1） | ≤4.8k 条 | 未实现 |

## 范围外（v1 不做，给替代）

| 不做 | 理由 | 替代 |
|---|---|---|
| MCP server | 工具 schema 常驻 + 三端配置分叉 | CLI + skill（ADR-0001） |
| 多用户 / RBAC | 单人用不到 | 每设备一 token，独立撤销 |
| 服务端 LLM 抽取 | 撞 10 ms CPU + 费用 | agent 自写摘要（ADR-0003） |
| 图 / 时态图谱 / 实体消解 | 复杂度超需求 | 需要时迁 Hindsight |
| Web UI | 非必要 | `loam list --json` |
| 跨 project 全局语义搜索 | 混淆边界 | 按 project 隔离 + `--all` 显式跨库 |
| 自动遗忘引擎 | 单人可控 | `loam prune --older 180d` |
| 非 CF 后端 | 无第二实现 | v2 抽 Storage 接口 |
| E2E 加密 | 无密钥管理 | 敏感内容不写（SECURITY.md） |
| CRDT | 单人假设 | LWW + hash 去重 |
| OAuth / refresh / SSO | 零收益全成本 | 静态 per-device token（ADR-0004） |

## 非目标

通用 RAG 平台、agent 编排、secrets 存储、多租户服务。

## 何时重审

- 出现第二个人使用同一后端 → 加 users 与 RBAC，重审 AUTH。
- 事实数长期逼近 20k 或 recall 命中率下降 → 评估 Vectorize 子集（v1.1）。
- DSH / Claude / Codex 任一端出现稳定插件 API → 评估 L3 插件壳（只做入口）。