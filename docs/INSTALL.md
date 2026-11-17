# Install

## 结论

不做三套插件：DSH Cordis / Claude marketplace / Codex 都没有稳定且同形的插件面，维护 ×3 且随版本漂移。`loam install` 覆盖插件能做的两件事：**放调用约定**（AGENTS.md / CLAUDE.md 标记块 + skill）与**装 hooks**（可选）。

| 层 | v1 | 内容 |
|---|---|---|
| L1 | 必做 | `npx @loam/cli install`：探测 → 勾选 → 逐端接线；`--dry-run`、`-y`、`--only` |
| L2 | 开源后 | npm -g / Homebrew tap / winget-scoop |
| L3 | 可选 | DSH Cordis 插件、Claude marketplace 条目，壳内只调用 installer |

## 探测与接线矩阵

| 端 | 通用面（必写） | 专用面 | 探测信号 | 自动触发 |
|---|---|---|---|---|
| DSH | 仓库 `AGENTS.md` 块 | `$DSH_HOME/AGENTS.md` 块；`skills/loam/SKILL.md` | `DSH_HOME` 或 `~/.dsh` | Cordis hook（v1.1） |
| Claude Code | 仓库 `AGENTS.md` 块 | `~/.claude/CLAUDE.md` 块；`~/.claude/skills/loam/SKILL.md` | `~/.claude`（或 `CLAUDE_CONFIG_DIR`） | UserPromptSubmit hook（可选） |
| Codex | 仓库 `AGENTS.md` 块 | `~/.codex/AGENTS.md` 块 | `CODEX_HOME` 或 `~/.codex` | Codex hooks（版本未定，v1 不装） |

- 探测不到任何目录 → 报错并提示用 `--only`。
- 交互环境用 `@clack/prompts` 多选；`-y` / `--dry-run` / 非 TTY 用全部探测结果。
- 路径全部 `os.homedir()` + `path.join`，不写死分隔符与盘符。

## 标记块

```
<!-- loam:start -->
## 项目记忆（loam）
…（≤200 token 的调用约定）
<!-- loam:end -->
```

- 重装只替换两标记之间，不碰原文；重复执行结果稳定（幂等）。
- 卸载删除块并保留其余内容；由 loam 创建的空文件直接删除。
- 手动编辑请保留 markers；`loam doctor` 会检查。

## install.json

`~/.loam/install.json`：

```json
{
  "version": "0.1.0",
  "installedAt": "2026-11-17T07:00:00.000Z",
  "repoRoot": "D:/Develop/CodeProjects/loam",
  "harnesses": ["dsh", "claude", "codex"],
  "files": [
    { "path": "…/AGENTS.md", "kind": "block", "harness": null, "created": false },
    { "path": "…/.claude/skills/loam/SKILL.md", "kind": "file", "harness": "claude", "created": true },
    { "path": "…/.claude/settings.json", "kind": "hooks", "harness": "claude", "created": true }
  ]
}
```

`created` 决定卸载语义：loam 创建的文件在清空后删除，原本存在的文件只去块。

## hooks（可选）

- 默认只装「开工前注入」一次，不装每轮注入；`--with-hooks` 才写 Claude Code `settings.json`：

```json
{ "hooks": { "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "loam inject" } ] } ] } }
```

- `loam inject` 输出 ≤3 条 × 60 字符，总计 ≤800 字符；无配置/网络失败静默退出 0，绝不断 harness 的 prompt。
- 卸载只移除 `command === "loam inject"` 的条目；`settings.json` 解析失败时中止并提示，不覆盖用户文件。

## doctor

| 检查 | 失败时的 fix |
|---|---|
| `config` | `loam login --server URL --name NAME` |
| `token`（`/v1/me`） | 同上（401 时） |
| `repo-block` | `loam install` |
| `install`（install.json） | `loam install` |
| `files`（skill 是否还在） | `loam install` |
| `last-recall` | `loam search "keyword"` |

## uninstall

```bash
loam uninstall --dry-run   # 打印回滚清单
loam uninstall -y
```

- 按 install.json 逆操作：去块 → 删技能文件（含空目录）→ 移除 hook → 删 install.json。
- 不删除 `~/.loamrc.json`、outbox、缓存与 D1 数据；需要时手动处理。

## harness 沙箱

- Codex 默认 `workspace-write` 沙箱会拒绝写 `~/.loam` 并阻断代理网络，`loam add` 会先报网络错误、再报 outbox 不可写。实测需 `codex exec --dangerously-bypass-approvals-and-sandbox`，或配置放行 network 与 home 写；也可把 `LOAM_DIR` 指到 workspace 内可写目录。
- Claude Code 无头模式可直接调用：`claude -p --allowedTools "Bash(loam:*)"`（实测 provenance 为 `claude`）。
- DSH：`~/.dsh/AGENTS.md` 与仓库 `AGENTS.md` 的标记块随会话加载（本仓库实测）。

## 版本漂移

- harness 目录与 hook 事件名集中在 `cli/src/install/harness.ts` 与 `hooks.ts`。
- 任何路径变化先 `loam install --dry-run` 看实际写入，再决定是否改映射。
- 不做「探测失败即自动猜测」：宁可报错，也不写错文件。