# 0007 迁移路径：schema.sql 只用于全新库，部署前按迁移校验

## 背景

2026-11-18 的 deploy 失败：workflow 对 0.1 线上库执行 `schema.sql`。`CREATE TABLE IF NOT EXISTS` 不会补列，随后的 `CREATE INDEX … (project, pinned, …)` 直接报 `no such column: pinned`，部署中止。

## 决策

- `worker/schema.sql` **只用于全新库**；任何已有库只跑 `worker/migrations/NNNN-*.sql`。
- 迁移文件保持有序、只增列/加索引；每一步都在本地 `node:sqlite` 上验证。
- `deploy` 前把线上 `pragma_table_info('facts')` 交给 `scripts/check-d1-schema.mjs`：脚本从所有迁移文件提取 `ADD COLUMN`，缺任何一列就失败。
- 离线测试 `worker/test/offline/migrations.test.ts` 用 0.1 fixture + 迁移，断言列与索引和全新 schema 完全一致。
- CI **不写生产库**：迁移仍是人工步骤（先 `wrangler d1 export` 备份，再 `--remote`）。

## 代价

- 只校验列；新增表/触发器/回填需要另加断言或账本。
- `schema.sql` 必须与迁移同步更新，否则离线测试会抓到漂移。

## 替代

- CI 自动迁移：每次部署都写生产库、缺少人工确认；出现第二套环境再评估。
- `schema_migrations` 账本 + runner：当前只有一条迁移，收益不足；迁移数 >3 时升级。

## 何时重审

出现第一条非纯增列迁移、第二套 D1 环境，或迁移文件超过 3 个。