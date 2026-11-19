# loam

[简体中文](README.md) · **English**

[![npm version](https://img.shields.io/npm/v/@yidasanqian%2Floam)](https://www.npmjs.com/package/@yidasanqian/loam)
[![npm downloads](https://img.shields.io/npm/dm/@yidasanqian%2Floam)](https://www.npmjs.com/package/@yidasanqian/loam)
[![CI](https://github.com/yidasanqian/loam/actions/workflows/ci.yml/badge.svg)](https://github.com/yidasanqian/loam/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![node](https://img.shields.io/node/v/@yidasanqian%2Floam)](cli/package.json)

**Every new session, you explain your project's rules again.**

loam keeps those rules as one line per fact (decision / pitfall / convention / fact), deduped and ranked at write time, and injects ~200 tokens before a task.
Claude Code, Codex and DSH read the same store, so switching tools loses nothing; no MCP, no vector store, no auto-transcription. The backend runs on Cloudflare's free tier, or deploy it to your own account in one click.

**[Open the workbench →](https://loam-demo.pages.dev)** — fake data, no backend, the page sends no network requests.

```bash
npx @yidasanqian/loam onboard --server https://loam.example.workers.dev --name my-laptop
```

That logs this machine in, writes the harness conventions, and installs the skill. The first registration needs `ADMIN_TOKEN`:

```bash
LOAM_ADMIN_TOKEN=... npx @yidasanqian/loam onboard --server https://loam.example.workers.dev --name my-laptop
```

> No backend yet? Use [one-click deploy](#option-a-one-click-deploy) below, then run this line.
> Re-running it is safe: with an existing token, `onboard` skips the login and only refreshes the wiring.

```text
$ loam add "Bearer tokens are per-device" --kind decision --tags auth
+ 3f9c2a1e [decision] loam

$ loam search "auth token"
- [decision] Bearer tokens are per-device (claude · 2026-11-18 · 3f9c2a1e · 4/5)
```

> Example output. Recall returns 5 facts by default, ≤100 chars each; only the first 3 are injected into the harness.

**Screenshots** [workbench](#memory-workbench) · **Deploy** [one-click](#option-a-one-click-deploy) / [CLI](#option-b-command-line) / [Pages](#option-c-cloudflare-pages) · **Docs** [docs/](docs/)

## Not another memory tool

- **Not an MCP server**: usage is a CLI + skill, no long-running process, no tool-slot cost; about 200 tokens per injection.
- **Not auto-transcription or a vector store**: you decide what is written, one line per fact; dedupe, supersede and ranking happen at write time, so recall is explainable.
- **Not a team collaboration platform**: single user, many devices; tokens are per device, revoking one leaves the others alone, and the data lives in your own D1.
- **Not tied to one harness**: the same memory is written and read by Claude Code, Codex and DSH.

## Start in three steps

1. **Get a backend**: click [one-click deploy](#option-a-one-click-deploy), or run `wrangler deploy` yourself as in [option B](#option-b-command-line).
2. **Wire the harnesses**: run `onboard` above; with an existing token it skips login and only refreshes the wiring.
3. **Use it**:

   ```bash
   loam search "keywords"
   loam add "D1 is the single source of truth" --kind decision --importance 4
   ```

Once wired, the harness runs `loam search` before a task and `loam add` when something is worth keeping. Self-check with `loam doctor`, roll back with `loam uninstall`, refresh only the skill with `npx skills update loam`.

## Compatibility

| Harness | Convention | Skill | Hook |
|---|---|---|---|
| Claude Code | `~/.claude/CLAUDE.md` marker block | `npx skills add` (agent `claude-code`) links into `~/.claude/skills/loam` | optional: `onboard --with-hooks` installs `UserPromptSubmit` |
| Codex | `~/.codex/AGENTS.md` marker block | `npx skills add` (agent `codex`) | — |
| DSH | `~/.dsh/AGENTS.md` marker block | linked into `~/.dsh/skills/loam` (the Skills CLI has no DSH agent, so loam links it) | — |
| Other Skills CLI agents | manual AGENTS.md marker block | `npx skills add yidasanqian/loam --skill loam --global` | — |

The repository's own `AGENTS.md` also receives the marker block, so project-level conventions travel with the repo.

A DSH Cordis plugin is still a plan ([PLAN.md](PLAN.md), v1.1). Everything a plugin would give you — the convention block and the skill link — `onboard` already does, and Claude Code can install the hook on top, so there is nothing to wait for.

## Memory workbench

Open your worker URL and paste the token from `~/.loamrc.json`:

- **Board**: decision / pitfall / convention / fact as four lanes; drag a card to reclassify it, the page never scrolls.
- **Inspector / Review**: full text, provenance, pin, importance, supersede chain; review one card at a time.
- **Timeline / Model**: four time buckets; a memory-model diagram mapped to code.
- Bilingual (zh / en), following the browser language.

**Workbench · 1440×900**

![loam workbench: four lanes, cards and the capture dock](docs/images/loam-board.png)

**Memory model diagram · 1440×1260**

![loam memory model diagram: write, shape, recall, upkeep](docs/images/loam-model.png)

**Mobile · 390×844**

![loam on mobile: one lane with horizontal snap and the capture dock](docs/images/loam-mobile.png)

The page is served from Workers Assets (`worker/public/`) and calls `/v1/*` same-origin. No build step, no framework, no third-party frontend dependency. The same page can be hosted on Cloudflare Pages (see [option C](#option-c-cloudflare-pages)).

`loam-demo.pages.dev` is that same UI as a static demo: fake data, no backend, not a single request leaves the page. Use it to drag cards and switch views before deploying anything.

## Self-hosting

Three methods; pick one. Full steps, limits and backups: [docs/DEPLOY.md](docs/DEPLOY.md).

### Option A: one-click deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yidasanqian/loam/tree/main/worker)

Click it: Cloudflare copies `worker/` into your GitHub account, creates the Worker and D1, prompts for `ADMIN_TOKEN`, runs the `deploy` script (schema, then deploy), and wires up Workers Builds. Afterwards you only bind a domain (optional), then wire this machine with `onboard` above.

### Option B: command line

```bash
cd worker
pnpm dlx wrangler d1 create loam
pnpm dlx wrangler d1 execute loam --file=./schema.sql --remote   # fresh database; existing ones run migrations/
pnpm dlx wrangler secret put ADMIN_TOKEN
pnpm run deploy
```

For an existing database run only the migration; backups, rollback and proxy setup are in [docs/DEPLOY.md](docs/DEPLOY.md).

### Option C: Cloudflare Pages

[![Deploy to Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare_Pages-F6821F?style=for-the-badge)](https://dash.cloudflare.com/?to=/:account/workers-and-pages)

Cloudflare's Deploy button supports Workers applications only ([official limitation](https://developers.cloudflare.com/workers/platform/deploy-buttons/)), so this button opens the Workers & Pages dashboard: pick `Create application → Pages → Connect to Git`, choose this repository, and fill in the three fields below.

| Dashboard field | Value |
|---|---|
| Root directory | `pages` |
| Build command | `node ../scripts/build-pages.mjs` |
| Build output directory | `public` |

The `DB` binding comes from `pages/wrangler.toml`; add `ADMIN_TOKEN` under Settings → Variables and Secrets before the first activation, or run `wrangler pages secret put ADMIN_TOKEN`.

Or do the same build from the command line:

```bash
pnpm dlx wrangler d1 create loam          # skip if you already have the Worker database
pnpm dlx wrangler pages project create loam --production-branch main
pnpm dlx wrangler pages secret put ADMIN_TOKEN
pnpm pages:deploy                          # rebuilds pages/public, then uploads
```

Pages has no `ratelimits` binding, so rate limiting degrades to the single-isolate in-memory fallback; schema, migrations and limits: [docs/DEPLOY.md](docs/DEPLOY.md).

## For developers

```bash
pnpm install
pnpm check        # typecheck + tests + licenses + i18n
```

Local worker / CLI debugging, code conventions, CI and publishing: [CONTRIBUTING.md](CONTRIBUTING.md).
Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); released versions: [CHANGELOG.md](CHANGELOG.md).

## Docs

- [docs/DEPLOY.md](docs/DEPLOY.md) three deploy paths, migrations, backups, proxy
- [docs/INSTALL.md](docs/INSTALL.md) harness wiring and rollback
- [docs/CLI.md](docs/CLI.md) command reference
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) components, data flow, storage
- [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) dependencies and licenses
- [docs/UI.md](docs/UI.md) workbench layout, diagram map, manual checklist
- [docs/AUTH.md](docs/AUTH.md) device tokens, revocation, rate limits
- [docs/SCOPE.md](docs/SCOPE.md) scope and quantified boundaries
- [CHANGELOG.md](CHANGELOG.md) versions and changes
- [demo/](demo/) static demo page: fake data, no backend, deployed by CI
- [CONTRIBUTING.md](CONTRIBUTING.md) development, tests, CI, publishing
- [SECURITY.md](SECURITY.md) plaintext boundary and reporting

If loam is useful to you, a star helps; questions and ideas go to [Issues](https://github.com/yidasanqian/loam/issues).

Apache-2.0. Original plan: [PLAN.md](PLAN.md).