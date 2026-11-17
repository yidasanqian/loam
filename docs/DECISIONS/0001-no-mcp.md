# 0001 — 不做 MCP server

- **背景**：三种 harness 都支持 MCP，但工具 schema 常驻上下文，三端配置分叉，且每次调用都占 token。
- **决策**：v1 只提供 CLI + skill；installer 把调用约定写进 AGENTS.md 标记块，agent 通过 shell 调用 `loam`。
- **代价**：agent 需要一次 exec 才能取记忆；没有结构化工具参数校验。
- **替代**：MCP server（schema 常驻、三端配置）；HTTP API 直连（需要 agent 会写 HTTP）。
- **何时重审**：任一端出现稳定的「零配置 MCP」与按需加载 schema 的能力，且 CLI 调用失败率明显高于工具调用。