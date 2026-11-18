# CLI

```
loam <command> [options]
```

## 全局

| 项 | 值 |
|---|---|
| 配置 | `~/.loamrc.json`（`LOAMRC` 可覆盖） |
| 本地目录 | `~/.loam/`（`LOAM_DIR` 可覆盖） |
| 环境变量 | `LOAM_SERVER` `LOAM_TOKEN` `LOAM_DEVICE_ID` `LOAM_DEVICE_NAME` `LOAM_PROJECT` `LOAM_HARNESS` `LOAM_ADMIN_TOKEN` |
| 退出码 | 0 成功 · 1 服务端/校验错误 · 2 用法/配置 · 3 鉴权（401） · 4 离线（已可 flush） |
| 输出 | 人类可读行；`--json` 输出服务端原始结构 |
| 超时 | 单请求 20s；超时按离线处理（写 queued / 读缓存） |

### 网络代理（workers.dev 直连超时时）

代理来源按优先级：`HTTPS_PROXY` / `HTTP_PROXY` → `LOAM_PROXY` → `login --proxy` 存入 `~/.loamrc.json`。检测到代理时 CLI 自动以 `--use-env-proxy` 重执行一次（Node ≥24），之后无需再设环境变量：

```bash
loam login --server https://loam.sanqian.workers.dev --name win-desktop --proxy http://127.0.0.1:7890
loam search "keyword"          # 自动走配置里的代理
```

`NODE_USE_ENV_PROXY=1` 在 Node 24.19 实测无效；直接 `node cli/dist/bin.js` 时可用 `NODE_OPTIONS=--use-env-proxy`。写入失败仍会落 outbox，恢复后 `loam flush`。

## login

```bash
LOAM_ADMIN_TOKEN=... loam login --server https://loam.<acct>.workers.dev --name win-desktop
loam login --server URL --name win-desktop --admin-token-file ~/.loam-admin
```

- 同名设备再次 login = 轮换 token，旧 token 立即失效。
- ADMIN_TOKEN 读取顺序：`--admin-token-file` → `LOAM_ADMIN_TOKEN` → TTY 隐藏输入。
- token 明文只写入 `~/.loamrc.json`，不打印。

## add

```bash
loam add "D1 is the source of truth" --kind decision --tags arch,cf
echo "long text" | loam add --stdin --kind pitfall
loam add "offline note" --offline
```

- `project` 默认：`LOAM_PROJECT` → git 根目录名 → cwd 目录名，非法字符转 `-`。
- `kind`：`decision` `pitfall` `convention` `fact`（默认 `fact`）。
- `--pin`：标为常驻，注入与复盘优先，`prune` 不删；建议每 project ≤8 条。
- `--importance 1..5`：排序权重，默认 3（1 低、5 高）。
- `--supersedes <id8>`：这条新事实取代旧事实。旧条目退出默认召回，`show` 仍可查看；服务端另有 `PATCH {supersededBy:null}` 可取消取代。
- 幂等键：`sha256(project ␀ kind ␀ 规范化空白后的 text)`；重复写入输出 `= 已存在 <id8>`。
- 网络失败或 5xx 自动落 `~/.loam/outbox.jsonl`；4xx 直接报错（含 `invalid_supersedes`）。
- 单条 text ≤4 KB；tags ≤8；project ≤128 字符。

## search

```bash
loam search "bearer token"
loam search "marker" -k pitfall -t installer -l 3
loam search --all "wrangler"          # 跨 project
loam search "x" --json --no-cache
```

- 默认 5 条，硬上限 5；输出 ≤6 行（5 条 + 更多提示），每行 ≤100 字符。
- 排序：`--sort rank`（默认，`★ 常驻 > importance > 时间`）或 `--sort recent`（纯时间倒序）。
- 默认不返回被取代（superseded）的条目；跨历史查看用 Web 搜索或 `loam show`。
- `q` 按空白拆词，最多 5 个词，词间 AND、每词子串匹配（`search "source truth"` 命中同时含两词的文本）。
- 每行格式：`- [kind] ★? text (harness · YYYY-MM-DD · id8 · n/5?)`；`★` 表示常驻，`n/5` 仅重要度 ≠3 时出现。
- 网络失败时读 `~/.loam/cache/search-*.json`，stderr 标注「离线：显示 N 分钟前的缓存」。
- 每次 search 记录 `~/.loam/last-recall.json`，供 `loam doctor`。

## show / list

```bash
loam show 9f1c2d3e      # 8 位前缀即可
loam list -n 20 --json
loam list --all -k decision
```

`show` 输出全文与 provenance；`list` 与 search 同格式，默认 20 条（1..50）。

## devices

```bash
loam devices
loam devices revoke 9f1c2d3e --yes
loam devices rotate 9f1c2d3e        # 新 token 只打印一次
```

## export / import

```bash
loam export --out facts.ndjson        # 当前 project
loam export --all --out all.ndjson
loam import facts.ndjson --project loam
```

NDJSON 每行：`{project,kind,text,tags,harness,pinned,importance,created_at}`；import 每批 200 条，服务端按 hash 去重并接受 `pinned/importance`（`superseded_by` 不在导入范围内）。

## flush

```bash
loam flush          # 依序重放 outbox；遇到网络失败停下，保留尾部
loam flush --quiet
```

- 4xx（除 401）判为不可重试并丢弃并计数；401 保留，登录后再次 flush。
- 重放依赖服务端幂等，重复 flush 不会产生重复行。

## prune

```bash
loam prune --older 180d -y
loam prune --all --older 90d
```

软删除（`deleted_at`），不物理删除；`pinned` 常驻条目不参与 prune；`--yes` 供非交互环境。

## upgrade

```bash
loam upgrade            # 当前 CLI / npm 最新 / 接线版本；给出升级与刷新命令
loam upgrade --json
```

不自动安装（全局 npm 自替换在 Windows 上不可靠）。输出 `npm i -g @yidasanqian/loam@latest` 与 `loam install`；`loam doctor` 的 `version` 项会在接线版本与 CLI 不一致时失败。

## install / uninstall / doctor / inject

```bash
loam install [--only dsh,claude,codex] [--dry-run] [-y] [--with-hooks] [--repo PATH]
loam uninstall [--dry-run] [-y]
loam doctor
loam inject [--max 3] [--project P]
```

- `inject` 供 hook 使用：按 `sort=rank` 取前 N（常驻优先），输出 `<loam>…</loam>`，最多 3 条 × 60 字符，总计 ≤800 字符；无配置或网络失败时**静默且退出 0**。
- `doctor` 逐项检查 config / token / repo 标记块 / install.json / 文件 / 最近 recall，失败项附修复命令。
- 详见 [INSTALL.md](INSTALL.md)。