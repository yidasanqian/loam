# Security Policy

## 支持版本

| 版本 | 支持 |
|---|---|
| 0.1.x | 是 |

## 报告

请用 GitHub Security Advisory（仓库启用后）或开一个标题以 `security:` 开头的私有 issue。不要公开 PoC。
72 小时内确认，修复后在此文件记录。

## 设计上的明文边界（务必先读）

loam **不做端到端加密**，服务端 D1 里的记忆是明文：

- 运维者（部署者本人）可以直接读 D1。
- 任何拿到设备 token 的人可以读该 project 的**全部**事实。
- 任何拿到 ADMIN_TOKEN 的人可以发放新设备 token。

因此：

1. **不要写入密钥、密码、token、恢复码、身份证件、个人隐私、客户数据。**
2. 敏感但需要跨端共享的内容，应拆成「指向安全存储的引用」而不是内容本身。
3. 撤销设备不等于删除数据：`loam prune` 是软删除，D1 仍保留文本。

## Token 处理

- 设备 token：`loam_<id8>_<32B base64url>`；服务端只存 SHA-256(hex)，用唯一索引查找，不做字符串比较。
- ADMIN_TOKEN：只用于 `/v1/activate`，通过 `x-admin-token` 或 Bearer 传入；不要写进仓库、命令行或 URL。
- 客户端：`~/.loamrc.json`（POSIX 0600）。token 不进 argv、不进 URL、不进 prompt 上下文。
- 泄漏处置：`loam devices revoke <id>`（或直接改 D1），再 `loam login --name …` 轮换。

## 限流

- `/v1/activate` 10/min/IP；`/v1/*` 60/min/设备（Workers `ratelimits` binding）。
- 本地与测试使用进程内兜底，仅单 isolate，不构成生产防护。

## 部署建议

- 只暴露 Worker 的 HTTPS 入口；`wrangler.toml` 中的 D1 id 与账号信息不属于 secret，但也不要公开改过的私有配置。
- 可选 Cloudflare Access + Service Token 保护 `/v1/activate`，设备侧仍用 bearer。
- 定期备份：`loam export --all --out backup.ndjson`；D1 时间点恢复由 Cloudflare 提供。

## 不做的防护

- 服务端加密、字段级 ACL、审计日志、WAF 规则、入侵检测：v1 单人模型下不引入。
- 供应链：运行时依赖仅 4 个，CI 跑许可证白名单（`pnpm check:licenses`）。