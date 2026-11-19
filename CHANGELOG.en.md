# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/), SemVer.

This file holds the English entries. GitHub Release notes are assembled by `scripts/release-notes.mjs` from this file (English on top) and [CHANGELOG.md](CHANGELOG.md) (Chinese below), so a released version must exist in both files or the release job stops before publishing.

## [0.5.0] - 2026-11-19

### Added

- Static workbench demo under `demo/`: every fact is hard-coded in `mock-api.js`, `window.fetch` is taken over on load, and `connect-src 'none'` in `_headers` blocks anything the mock misses, so the page never reaches the network. It has its own Pages pipeline (`demo.yml`) with no Worker, no D1 and no token, which keeps the demo at zero backend quota.
- `scripts/metrics.mjs`: a weekly snapshot of externally visible signals (GitHub 14-day traffic, repository popularity, npm version and downloads) as a Markdown table or `--json`. Self-hosted instance activity stays in the user's own D1 and is not collected.
- The Pages pipeline creates the Pages project before the first deploy instead of failing on a missing project.

### Changed

- `deploy.yml` redeploys the Worker only when its own inputs change; README-only edits no longer restart it.
- README (both languages) opens with the pain point and links the live demo; `docs/STATUS.md` is gone and milestones point at CHANGELOG.
- The workbench capture bar stays inside the viewport on narrow screens.

### Notes

- A tag now publishes a GitHub Release alongside the npm package. The body is bilingual: English first, Chinese below.