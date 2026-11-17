# loam 计划（v3）

- 状态：待批准（会话内三次 exit_plan_mode 均返回未批准，本文件为最新版快照）
- 日期：2026-11-17
- 项目根：D:\Develop\CodeProjects\loam
- 一句话：单人、Win/macOS 两台设备、DSH/Claude Code/Codex 三种 harness，共享同一项目的长期记忆。Cloudflare 免费层承载，CLI + skills 接入，不做 MCP。

## 1. 名字
**loam**（壤土：沉积的养分层，根系在其间共享）。命令 loam，包 @<scope>/loam。
已排除（实测冲突）：mycel/mycelium、stele、scrinium、tessera、menhir、mneme、memtrail、memcell。
M0 第一步核验：npm view loam / GitHub 搜 / Google 首页；裸名被占则只发 scope 包，命令名不变。

## 2. 目标与验收
两台设备（Win/macOS）× 三种 harness（DSH / Claude Code / Codex）× 同一项目 = 同一份记忆。

验收：
1. A 机 DSH 写入 → B 机 Claude Code 新会话命中（project 同、device 异）。
2. 重复写 3 次 = 1 行。
3. 断网落 outbox，flush 后补齐。
4. 单次 search ≤ 6 行、每行 ≤ 100 字符（≤ 150 token）。
5. 撤销 A 机 token 后 A 401、B 正常。
6. 月用量 < 免费层 5%。

## 3. 边界（docs/SCOPE.md）

### 3.1 范围内（v1）
- 单人、2+ 设备、3+ harness 的项目级记忆
- 事实：project + kind(decision|pitfall|convention|fact) + text + tags + provenance(harness/device/time)
- CLI：login / add / search / show / list / devices / export / import / flush / prune
- 幂等（hash UNIQUE）、离线 outbox、默认裁剪
- Workers + D1 真相源；R2 可选；Vectorize 仅 v1.1
- per-device Bearer、撤销、scope、限流
- installer：一条命令接三端 + AGENTS.md 标记块 + 可选 hooks
- 文档：SCOPE / ARCHITECTURE / AUTH / CLI / INSTALL / DEPENDENCIES / 5 条 ADR

### 3.2 范围外（v1 不做，给替代）

| 不做 | 理由 | 替代 |
|---|---|---|
| MCP server | 工具 schema 常驻 + 三端配置分叉 | CLI + skill（ADR-0001） |
| 多用户 / RBAC | 单人用不到 | 每设备一 token |
| 服务端 LLM 抽取 | 撞 10ms CPU + 费用 | agent 自写摘要（ADR-0003） |
| 图 / 时态图谱 / 实体消解 | 复杂度超需求 | 需要时迁 Hindsight |
| Web UI | 非必要 | loam list --json |
| 跨 project 全局语义搜索 | 混淆边界 | 按 project 隔离 + --all |
| 自动遗忘引擎 | 单人可控 | loam prune --older 180d |
| 非 CF 后端 | 无第二实现 | v2 抽 Storage 接口 |
| E2E 加密 | 无密钥管理 | 敏感内容不写（SECURITY.md） |
| CRDT | 单人假设 | LWW + hash 去重 |
| OAuth / refresh / SSO | 零收益全成本 | 静态 token（ADR-0004） |

### 3.3 非目标
通用 RAG 平台、agent 编排、secrets 存储、把 loam 当多租户服务。

### 3.4 量化边界（代码里断言）

| 项 | 上限 |
|---|---|
| 单条记忆 | 4 KB |
| 单 project | 20k 条 |
| search 默认 | 5 条 × 100 字符 |
| 单任务 search | ≤ 2 次（skill 约束） |
| hook 注入 | ≤ 200 token / 3 条 |
| Worker CPU | ≤ 10 ms |
| Vectorize（v1.1） | ≤ 4.8k 条 |

## 4. 安装与分发（docs/INSTALL.md）

### 4.1 结论：不做三套插件
插件格式三分（DSH Cordis / Claude marketplace / Codex 无插件体系），维护 ×3 且随版本漂移；插件能给的只有「放调用约定 + 装 hooks」，installer 全覆盖。插件壳留到开源后，壳内只调用 installer。

### 4.2 三层
- L1（v1 必做）：npx @<scope>/loam install — 探测 → 勾选 → 逐端接线；--dry-run、-y、--only dsh,claude,codex
- L2（开源后）：npm -g / Homebrew tap / winget-scoop
- L3（可选）：DSH Cordis 插件、Claude marketplace 条目，只做入口

### 4.3 installer 规范
- 幂等：AGENTS.md / CLAUDE.md 用 <!-- loam:start --> ... <!-- loam:end --> 标记块，重装替换，卸载删块，不碰原文
- 探测优先：DSH_HOME、~/.dsh、~/.claude、~/.codex 存在才接线，探测不到跳过并提示
- 记录 ~/.loam/install.json（端、文件清单、版本），供 doctor / uninstall / 升级
- 跨平台：os.homedir() + path.join，不写死分隔符与盘符
- loam doctor：token 有效性 / skill 路径 / hook 注册 / 最近 recall，并给修复命令
- loam uninstall：按 install.json 精确回滚

### 4.4 三端接线矩阵

| 端 | 通用面（必写） | 专用面 | 探测信号 | 自动触发 |
|---|---|---|---|---|
| DSH | repo AGENTS.md 块 | ~/.dsh/AGENTS.md 块；探测到写 skill 目录 | DSH_HOME / ~/.dsh | Cordis 插件 hook（v1.1） |
| Claude Code | repo AGENTS.md 块 | CLAUDE.md 块；~/.claude/skills/memory/SKILL.md | ~/.claude | UserPromptSubmit hook（可选） |
| Codex | repo AGENTS.md 块 | ~/.codex/AGENTS.md 块 | ~/.codex | codex_hooks 后的 hooks（可选） |

hook 事件名与 skills 目录有版本差异：installer 内做映射表 + --dry-run 打印实际写入，实测为准，不写死。

### 4.5 自动触发的 token 约束
默认只装「开工前注入」一次，不装「每轮注入」。注入 ≤ 200 token / 3 条 / 每条 ≤ 60 字符，超限截断。

## 5. 鉴权（docs/AUTH.md）
**一层：per-device Bearer token。** 设备码不做独立鉴权，只做 v1.1 的发放方式（产物仍是 bearer）。

| 方案 | v1 | 说明 |
|---|---|---|
| 静态 per-device Bearer | 是 | 粘贴一次，零 UI，可撤销可轮换 |
| OAuth Device Grant | v1.1 | 只换发放方式 |
| CF Access + Service Token | 可选 | 保护 /activate，免费 50 seats |
| refresh / SSO | 否 | 单人无收益（ADR-0004） |

- 格式 loam_<deviceId8>_<32B base64url>；服务端只存 SHA-256(hex)
- 校验 WHERE token_hash = ?（索引查找，不做字符串比较，无时序侧信道）
- 客户端 ~/.loamrc.json（0600），可选 Keychain / DPAPI
- token 不进命令行参数、不进 URL、不进上下文：login 走 stdin / --token-file
- last_seen_at 节流写（5 分钟一次），避免烧 D1 行写配额
- 限流用 Workers 原生 ratelimits binding（免费层可用）：/v1/auth/* 10/min/IP，/v1/* 60/min/设备

```sql
CREATE TABLE devices (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT "read,write",
  created_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER
);
```

生命周期：login --name / --rotate / devices list / devices revoke。撤销即刻生效，其他设备不受影响。

## 6. 复用与借鉴（docs/DEPENDENCIES.md + ADR-0005）

### 6.1 原则
通用基础设施一律用现成库；本项目特有逻辑（标记块安装、幂等 hash、outbox、输出裁剪）自己做，30-80 行，引库更贵。**不造轮子 ≠ 依赖拉满。**

### 6.2 运行时依赖（上限 5 个）

| 用途 | 采用 | 许可证 | 理由 |
|---|---|---|---|
| Worker 路由 | Hono | MIT | Workers 生态标准，配官方 vitest 池 |
| CLI 解析 | commander | MIT | CJS/ESM 双支持，Windows 参数最稳 |
| 安装交互 | @clack/prompts | MIT | 勾选 harness，活跃维护，无 postinstall |
| 终端着色 | picocolors | MIT | 最小实现，比 chalk 轻一个量级 |
| 测试 | vitest + @cloudflare/vitest-pool-workers | MIT/Apache | 官方池，能测 D1 binding |

### 6.3 设计借鉴（不拷代码）

| 对象 | 状态 | 借什么 | 不借什么 |
|---|---|---|---|
| Hindsight coding-agents（MIT） | 活跃 | install <harness> 一命令一端；bank = {gitProject} 作用域 | 服务端抽取、图检索 |
| AgentMemory（Apache-2.0） | 活跃 | connect <harness> --with-hooks 与环境变量注入 | 单体服务、loopback 绑定 |
| Engram（AGPL） | 活跃 | Git-project scope 作为项目身份 | 代码零拷贝（AGPL 传染） |
| Basic Memory（AGPL） | 活跃 | project 目录化、人可读优先 | 代码零拷贝；markdown 双写冲突不用 |
| Graphiti（Apache-2.0） | 活跃 | group_id 式显式作用域键 → project 字段 | 时态图、实体消解 |
| Letta trajectory（Apache-2.0） | 活跃 | 会话归一化字段命名 → provenance | 整套 runtime |
| @modelcontextprotocol/server-memory | 活跃 | entity/relation 分类启发 → kind | 本地 JSON 单文件、MCP 形态 |

### 6.4 明确不引
MCP SDK（本就不做）、ORM（Drizzle 引 schema 生成链，两端点不值）、mem0/cognee 类框架（带入整套抽象）、向量库 SDK（v1.1 才评估）。

### 6.5 依赖准入规则（ADR-0005）
- 近 6 个月有提交、周下载 > 10k、许可证 MIT/Apache、无 postinstall 脚本
- Worker 侧依赖必须在 Workers runtime 可跑（用官方 vitest 池验证）
- 每个新增依赖在 DEPENDENCIES.md 记一行：用途 / 版本 / 许可证 / 替代方案
- 标准库优先：node:crypto、node:fs（原子 rename）、fetch、AbortSignal 能解决的不引库
- 手写校验阈值：端点 ≤ 3 且字段 ≤ 6 时手写（15 行 + 单测）；超过再引 zod

### 6.6 许可证边界
AGPL 项目只读设计不拷代码；MIT/Apache 若引片段必须记来源与许可证。npm 依赖全部 MIT/Apache 白名单，CI 里加 license 检查。

## 7. 仓库结构

```
D:/Develop/CodeProjects/loam/
├── PLAN.md                     # 本文件
├── README.md  LICENSE(Apache-2.0)  CHANGELOG.md  CONTRIBUTING.md(DCO)  SECURITY.md
├── docs/ SCOPE.md  ARCHITECTURE.md  AUTH.md  CLI.md  INSTALL.md  DEPENDENCIES.md
│   └── DECISIONS/ 0001-no-mcp  0002-cloudflare-only  0003-client-side-extraction  0004-bearer-not-oauth  0005-dependency-policy
├── worker/  src/index.ts  schema.sql  wrangler.toml  test/
├── cli/     src/bin.ts  install/  format.ts  outbox.ts  config.ts
├── skills/memory/SKILL.md
└── .github/ issue templates, CI
```

ADR 每条 5 行：背景 / 决策 / 代价 / 替代 / 何时重审。边界靠 ADR 固化。

## 8. 里程碑

| 阶段 | 产出 | 验收 |
|---|---|---|
| M0 骨架+边界（0.5d） | 目录、LICENSE、SCOPE、5 条 ADR、DEPENDENCIES、README 骨架、名字核验 | 每条「不做」有理由+替代；依赖表齐；许可证白名单写明 |
| M1 Worker+鉴权（1d） | devices 表、中间件、facts CRUD、限流、wrangler dev --local | 无 token 401；撤销即 401；双设备互不影响；CPU<10ms |
| M2 CLI MVP（1d） | login/add/search/show/list/devices/export/flush、幂等、outbox、裁剪 | 重复 add=1 行；断网→flush；输出 ≤6 行 |
| M2.5 installer（0.5d） | npx install、clack 勾选、标记块、--dry-run、install.json、doctor、uninstall | 一次装完三端；重装无重复块；uninstall 后 diff 干净 |
| M3 三端验收（0.5d） | SKILL.md、三端接线 | 三端各 1 次 recall 命中，provenance 正确 |
| M4 双机验收（0.5d） | 双设备 token、双向读写 | 第 2 节 6 条全过 |
| M5 开源发布（0.5d） | README、CI（含 license 检查）、npm --provenance、v0.1.0 | 新用户 30 分钟在 wrangler dev 跑通 |

合计约 4.5 天。v1.1：设备码发放、Vectorize 子集召回、Cordis 插件壳。

## 9. 测试矩阵

- 鉴权 5：无 token / 错 token / 已撤销 / 只读写 / 限流 429
- 同步 4：A→B、B→A、并发写不同事实、并发写同事实（幂等）
- 离线 2：断网 add→outbox→flush；重复 flush 不重复写
- 安装 4：空机器全装 / 只装 Codex / 重装幂等 / uninstall 后文件干净
- 边界 3：超 4KB 拒绝、超 20k 告警、空结果返回空
- 依赖 2：license 白名单检查、Workers runtime 冒烟

## 10. 开源治理
Apache-2.0（可改 MIT）；DCO 不设 CLA；SemVer；npm --provenance；SECURITY.md 写明「不要写入密钥、服务端不加密」。

## 11. 风险

| 风险 | 处置 |
|---|---|
| 裸名 loam 被占 | 只发 @<scope>/loam |
| harness 版本漂移导致 hook/skill 路径失效 | installer 探测 + doctor 自检 + 映射表可配 |
| hooks 注入推高 token | 默认只装开工前注入；200 token 硬截断 |
| 依赖腐化 | ADR-0005 准入 + 半年复审 + CI license 检查 |
| D1 每日行读写配额（2026-09 硬化） | 索引+LIMIT，禁 SELECT *；last_seen 节流 |
| 中国大陆访问 CF 延迟 | 读缓存 5min + 写 outbox |
| 免费层 10ms CPU | 禁 Worker 内重计算 |
| skills 不被触发 | AGENTS.md 标记块写硬约束 |
| 用户文件被污染 | 标记块 + install.json + 可回滚 |
| 借鉴合规 | AGPL 零拷贝；MIT/Apache 记来源 |

## 12. 假设
1. 项目根 D:/Develop/CodeProjects/loam。
2. 名字默认 loam，可改。
3. License 默认 Apache-2.0，可改 MIT。
4. v1 不做向量与设备码；不做独立插件壳。
5. 运行时依赖 5 个；超出需在 ADR-0005 里说明。

## 13. 下一步
批准后 M0：落盘目录 + SCOPE.md + 5 条 ADR + DEPENDENCIES.md + INSTALL.md 骨架 + LICENSE + 名字核验。
