# Dependencies

## 原则

通用基础设施用现成库；本项目特有逻辑（标记块安装、幂等 hash、outbox、输出裁剪）自己做，30–80 行，引库更贵。
**不造轮子 ≠ 依赖拉满。**

## 运行时依赖（4 个，上限 5）

| 用途 | 采用 | 版本 | 许可证 | 替代方案 |
|---|---|---|---|---|
| Worker 路由 | `hono` | ^4.6 | MIT | itty-router（MIT，更轻但无中间件生态）；手写路由需重复错误映射/参数解析 |
| CLI 解析 | `commander` | ^12.1 | MIT | `node:util.parseArgs`（无 help/子命令）；yargs（更重） |
| 安装交互 | `@clack/prompts` | ^0.9 | MIT | `readline` 手写多选；inquirer（更重，依赖多） |
| 终端着色 | `picocolors` | ^1.1 | MIT | 手写 ANSI 转义；chalk（重一个量级） |

## 开发依赖（不进运行时包）

| 用途 | 采用 | 版本 | 许可证 |
|---|---|---|---|
| 类型检查 / 构建 | `typescript` | ^5.7 | Apache-2.0 |
| Worker HTTP 集成测试 | `vitest` + `@cloudflare/vitest-pool-workers` | ^3.2 / ^0.8 | MIT |
| Worker 本地运行与部署 | `wrangler` | ^4 | MIT OR Apache-2.0 |
| Worker 类型 | `@cloudflare/workers-types` | ^4 | MIT OR Apache-2.0 |
| Node 类型 | `@types/node` | ^22.10 | MIT |

计划中的第 5 个依赖位即测试栈（vitest + 官方池），按 devDependency 计。

## 标准库优先

| 需求 | 用标准库 | 说明 |
|---|---|---|
| 哈希 / 随机 | `node:crypto` / WebCrypto | SHA-256、32B 随机 token |
| 原子写 | `node:fs` tmp + rename（Windows 回退 unlink） | `cli/src/util.ts` |
| HTTP | `fetch` + `AbortSignal.timeout(8000)` | 无 axios |
| 离线测试 SQL | `node:sqlite` | 仅测试，实现 D1 形状 adapter |
| 参数校验 | 手写 | 端点字段 ≤6，`worker/src/validate.ts` 约 120 行 + 测试；达到「跨端点复用 >3 次或字段 >10」再引 zod |

## 明确不引

- MCP SDK（本就不做，ADR-0001）
- ORM / Drizzle（只有两张表，schema 生成链不划算）
- mem0 / cognee 类框架（带入整套抽象）
- 向量库 SDK（v1.1 才评估 Vectorize）
- 日志 / 重试框架（Workers 自带 console + CLI 已有 outbox）

## 依赖准入（ADR-0005）

1. 近 6 个月有提交、周下载 > 10k、许可证 MIT/Apache、无 postinstall。
2. Worker 侧必须在 Workers runtime 可跑（官方 vitest 池验证）。
3. 每个新增依赖在本文件记一行：用途 / 版本 / 许可证 / 替代方案。
4. 运行时依赖超过 5 个需先改 ADR-0005 并说明。
5. 每半年复审一次；CI 跑 `pnpm check:licenses`（白名单：MIT、Apache-2.0、BSD-2/3-Clause、ISC、0BSD、CC0-1.0、Unlicense、BlueOak-1.0.0）。

## 许可证边界

- AGPL 项目只读设计、不拷代码：Hindsight、Engram、Basic Memory 均为「借设计」。
- Apache-2.0 / MIT 若引片段，必须在本文件记录来源与许可证。
- 本项目 Apache-2.0；可改 MIT（见 PLAN §10）。

## Lockfile 与安装脚本

- `pnpm-lock.yaml` 已生成并入库；CI 使用 `pnpm install --frozen-lockfile`。
- pnpm ≥10 默认拦截依赖 postinstall；`pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 只放行 `esbuild`、`sharp`、`workerd`（Wrangler / vitest 池必需），新增白名单需在本文件说明。
- 已验证安装的真实版本：hono 4.13.18、commander 12.1.0、@clack/prompts 0.9.1、picocolors 1.1.1、wrangler 4.162.0、vitest 3.2.7、@cloudflare/vitest-pool-workers 0.8.71、typescript 5.9.3。