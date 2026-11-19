# Auth

一层：**per-device Bearer token**。OAuth 设备码只作为 v1.1 的发放方式（产物仍是 bearer）。

## Token

```
loam_<deviceId8>_<32B base64url>
```

- `deviceId8`：设备 UUID 前 8 位，仅用于肉眼区分。
- 服务端只存 `sha256(token)` 的 hex，`devices.token_hash UNIQUE`。
- 校验是索引查找 `WHERE token_hash = ?`，不做字符串比较，无时序侧信道。
- token 只在两处出现明文：`/v1/activate` 的响应、`~/.loamrc.json`（POSIX 0600）。
- token 不进命令行参数、不进 URL、不进 prompt；`loam login` 从 env / 文件 / TTY 隐藏输入读取的是 **ADMIN_TOKEN**。

## 发放

`POST /v1/activate`：

```http
POST /v1/activate
x-admin-token: $ADMIN_TOKEN        # 或 Authorization: Bearer $ADMIN_TOKEN
{ "name": "win-desktop", "scopes": "read,write" }
→ 201 { created: true, device: {...}, token: "loam_…" }
```

- `ADMIN_TOKEN` 未配置 → 503 `not_configured`。
- 缺 token / 错 token → 401；比较前双方都做 SHA-256，常量时间比较。
- 同名设备再次 activate → 轮换 token（同一 `device.id`），旧 token 立即失效。
- 限流：10/min/IP（`RL_AUTH` binding；本地为进程内兜底）。

## 作用域

| scope | 允许 |
|---|---|
| `read` | `/v1/facts` GET、`/v1/facts/:id`、`/v1/export`、`/v1/stats`、`/v1/devices` GET、`/v1/me` |
| `write` | `POST /v1/facts`、`/v1/import`、`DELETE /v1/facts*`、设备 revoke/rotate |

缺 scope → 403 `forbidden`。单人模型下，任一 write 设备可撤销或轮换其它设备。

## 撤销与轮换

- `POST /v1/devices/:id/revoke` → `revoked_at=now`；该设备的后续请求立即 401，其它设备不受影响。
- `POST /v1/devices/:id/rotate` → 新 token 明文只返回一次；旧 hash 被覆盖。
- `loam devices` 列出 id / 名称 / scopes / 状态 / 最近活跃。
- 重新 `loam login --name X` 等价于对 X 轮换。

## last_seen

`UPDATE devices SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)`，
窗口 5 分钟（`LAST_SEEN_THROTTLE_MS`）。避免每次请求烧 D1 行写配额。

## 限流

`worker/wrangler.toml`：

```toml
[[ratelimits]]
name = "RL_AUTH"   # /v1/activate
namespace_id = "1001"
simple = { limit = 10, period = 60 }

[[ratelimits]]
name = "RL_API"    # /v1/* per device
namespace_id = "1002"
simple = { limit = 60, period = 60 }
```

- 生产：绑定由平台执行，Worker 只读 `success`。
- Cloudflare Pages 部署（[DEPLOY.md](DEPLOY.md) 方式 C）没有 `ratelimits` 绑定，等同下面的本地兜底，且按 isolate 计——限流强度以 token 撤销为准。
- 本地 / 测试：binding 缺失时用进程内滑动窗口兜底（`worker/src/rate.ts`），同阈值，仅单 isolate 有效。
- 实测：`wrangler deploy --dry-run` 与线上部署都识别 `RL_AUTH (10/60s)` 与 `RL_API (60/60s)`；本地 wrangler 4.162 的 miniflare 会对该字段告警并忽略，所以 `wrangler dev` / vitest 池走进程内兜底。
- 线上实测：从同一出口经代理并发 80 次请求（同一设备 token）未出现 429。官方文档明确 limit 按**Cloudflare location** 计数且「Requests can exceed this threshold」（最终一致）；跨 colo 的突发无法稳定触发。**结论：限流是纵深防御，不是硬配额**；真正的边界是 per-device token 与撤销。

## 客户端存储

`~/.loamrc.json`：

```json
{ "server": "https://loam.example.workers.dev", "deviceId": "…", "deviceName": "win-desktop", "token": "loam_…", "proxy": "http://127.0.0.1:7890" }
```

- `proxy` 可选；设置后 CLI 自动以 `--use-env-proxy` 重执行，适配直连 workers.dev 超时的网络。
- 环境变量覆盖：`LOAM_SERVER`、`LOAM_TOKEN`、`LOAM_DEVICE_ID`、`LOAM_DEVICE_NAME`、`LOAM_PROXY`、`LOAMRC`。
- 管理页把同一 token 存在浏览器 localStorage，只发往同源 `/v1/*`；CSP `default-src 'self'` + 全量 `textContent` 渲染，避免 token 进入 URL 或第三方请求。
- 权限：POSIX 写 0600；Windows 依赖用户目录 ACL。Keychain / DPAPI 不在 v1。
- 可选：Cloudflare Access + Service Token 保护 `/v1/activate`（免费 50 seats），设备侧仍用 bearer。

## 威胁模型（明确不做）

- 服务端不加密：D1 明文可见，运维者（你）可读。
- 无 E2E：没有密钥管理；**不要把密钥、口令、个人隐私写进 loam**。
- 无 refresh / SSO / SSO：单人零收益（ADR-0004）；token 泄漏的处置是 revoke + rotate。
- 传输依赖 HTTPS；`--server` 允许 http 仅为本地 wrangler dev。