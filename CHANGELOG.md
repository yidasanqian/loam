# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/), SemVer.

## [0.1.1] - 2026-11-18

### Changed

- 版本仅用于验证 Trusted Publishing（OIDC）自动发布；0.1.0 已发布，npm 不允许覆盖同版本。

## [0.1.0] - 2026-11-17

### Added

- Worker API（Hono + D1）：per-device Bearer、scopes、撤销/轮换、限流、facts CRUD、幂等写入、keyset 分页、软删除、导入导出、统计。
- CLI：`login` / `add` / `search` / `show` / `list` / `devices` / `export` / `import` / `flush` / `prune` / `install` / `uninstall` / `doctor` / `inject`。
- 离线 outbox（网络失败自动落盘，`flush` 幂等重放）与 5 分钟读取缓存。
- 输出契约：search 默认 5 条、≤6 行、每行 ≤100 字符；`inject` ≤3 条 / ≤200 token。
- installer：DSH / Claude Code / Codex 探测、`<!-- loam:start/end -->` 标记块、skill 复制、可选 Claude hook、`install.json`、`doctor`、`uninstall` 精确回滚。
- 记忆管理页（Workers Assets）：token 门禁、项目/类型/标签筛选、记录/修订/删除、NDJSON 导出、设备撤销；新增 `GET /v1/projects` 与 `PATCH /v1/facts/:id`。
- 文档：SCOPE / ARCHITECTURE / AUTH / CLI / INSTALL / DEPENDENCIES + 5 条 ADR；SECURITY / CONTRIBUTING。
- 测试：Worker 核心 SQL（node:sqlite）、Worker HTTP（vitest 官方池）、CLI 纯逻辑与安装回滚。
- CI：类型检查、两套测试、许可证白名单、wrangler dry-run。

### Fixed

- 搜索 `q` 改为按空白拆词（≤5），词间 AND，避免整串子串导致的假阴性。
- 代理网络下 CLI 自动以 `--use-env-proxy` 重执行；代理可存入 `~/.loamrc.json`。
- outbox 不可写时返回 `outbox_write_failed`，不再抛 EPERM 栈。
- CLI 请求超时放宽到 20s，doctor 对 token 检查重试一次。