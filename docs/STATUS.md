# Status

面向贡献者的进度快照。计划原文见 [PLAN.md](../PLAN.md)。

## 里程碑

| 阶段 | 状态 |
|---|---|
| M0 骨架 + 边界 + ADR | 完成 |
| M1 Worker + 鉴权 + facts CRUD + 限流 | 完成；HTTP 23/23 |
| M2 CLI MVP + outbox + 裁剪 | 完成；CLI 39/39 |
| M2.5 installer + doctor + uninstall | 完成 |
| M3 三端接线 / M4 双机验收 | 三端无头会话实测命中；第二台物理机未联调 |
| M5 CI / license / 发布 | 完成 |
| 记忆工作台 + 记忆形状（ADR-0006） | 完成 |
| skill 改由 `npx skills` 接线 | 完成；本地路径与三端可见性已验证 |
| Deploy to Cloudflare 一键部署 | 完成；按钮指向 `worker/`，部署脚本自动建表 |

## 已发布

| 版本 | 内容 |
|---|---|
| 0.1.0 | 首个公开发布（Worker + CLI + installer） |
| 0.1.1 | 记忆工作台、记忆形状、`loam upgrade` |
| 0.1.2 | 发布流程修正（provenance 条件化） |
| 0.1.3 | Workbench 重写、双语、迁移防回归；provenance 生效 |
| 0.2.0 | `onboard`、skill 改由 `npx skills` 接线、Deploy to Cloudflare 按钮、移动端适配 |

0.2.0 之后的改动见 [CHANGELOG.md](../CHANGELOG.md)。