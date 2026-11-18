# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/), SemVer.

## [0.1.3] - 2026-11-18

### Changed

- 发布完全走 GitHub Actions：tag → `release` workflow → OIDC Trusted Publishing + provenance；移除了手动 token 发布说明，不使用也不保存 `NPM_TOKEN`。
- 仓库改为 public；`release` workflow 对 public 仓库带 provenance、private 仓库自动去掉，当前发布走 provenance。

## [0.1.2] - 2026-11-18

### Changed

- release workflow 在 `npm publish` 前打印 OIDC claims（`aud` / `repository` / `job_workflow_ref` / `ref` / `environment` 等），用于核对 Trusted Publisher 配置。私有仓库带 `--provenance` 会被 npm 以 `E422` 拒绝，workflow 因此对 private 仓库改为不带 provenance、公开仓库自动带；0.1.2 发布时仓库为 private，未带 provenance。

## [0.1.1] - 2026-11-18

### Added

- 记忆工作台（`worker/public/` 重写）：四泳道工作台、检视抽屉、底部捕获、搜索面板、时间轴、复盘、记忆模型原理图；整页不滚动，窄屏横向 snap。
- 界面中英双语：`localStorage` → `navigator.languages`（RFC 4647 主语言匹配）→ `en` 协商；切换持久化，`<html lang>` 与 `Intl` 日期同步。
- 记忆形状（ADR-0006）：`pinned`、`importance(1..5)`、`superseded_by/at`；`sort=rank` 排序（常驻 > 重要度 > 时间）；默认召回过滤被取代条目。
- `GET /v1/stats` 增加 `byKind` / `pinned` / `superseded`；`POST /v1/facts` 支持 `supersedes`；`PATCH /v1/facts/:id` 支持 `pinned` / `importance` / 取消取代。
- CLI：`add --pin --importance --supersedes`、`search --sort rank|recent`（默认 rank）、`show` 显示常驻/重要度/取代；`inject` 按 rank 注入。
- 迁移 `worker/migrations/0002-memory-shape.sql`；[docs/UI.md](docs/UI.md)；本地样例脚本 `scripts/seed-dev.mjs`。
- 迁移防回归：`scripts/check-d1-schema.mjs` 在 deploy 前按所有 migrations 提取 `ADD COLUMN` 校验线上列；离线 `worker/test/offline/migrations.test.ts` 用 0.1 fixture 断言「旧库 + 迁移」与全新 schema 的列/索引一致。
- CLI：`loam upgrade` 检查 npm 最新版与 `install.json` 接线版本并给出命令；`loam doctor` 增加 `version` 一致性检查；skill 增加升级说明（`npm i -g …@latest` → `loam install`）。

### Changed

- `search` 默认排序改为 `rank`；`--sort recent` 保持旧行为。
- `prune` 跳过常驻条目；删除被取代目标时清空指向它的 `superseded_by`。
- NDJSON 导出与导入包含 `pinned` / `importance`。

### Fixed

- deploy workflow 不再对旧库盲目执行 `schema.sql`（会因 `no such column: pinned` 失败）；改为部署前按迁移声明的所有新增列校验，迁移仍按文档手动执行。

### Notes

- 仍未做：MCP、服务端 LLM 抽取、向量检索、多用户 RBAC、快捷键映射、界面以外内容的翻译。

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