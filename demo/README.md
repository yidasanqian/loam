# demo —— 静态工作台演示

给 README 和新访客看的工作台，**没有任何后端**：没有 Worker、没有 D1、没有 token、没有 Functions。

页面上的每条事实都写死在 [mock-api.js](mock-api.js) 里，`window.fetch` 在页面初始化时就被接管，所以页面永远不会发网络请求；`_headers` 里的 `connect-src 'none'` 是第二道保证——即使 mock 漏掉某个端点，浏览器也会直接拦掉，请求碰不到任何服务器。

## 为什么这么做

演示页因此不消耗 Cloudflare 免费层的任何后端配额：

- Pages 静态资源请求与带宽不计费，被大量访问也不会打穿账号；
- 没有 Functions，就不会有请求落进 Workers 的 100,000 请求/天；
- 没有 D1 绑定，就不会读掉 5M 行读/天（自 2026-09-01 起超限是直接报错，不是变慢）；
- 演示和真实后端物理隔离，演示流量再大也伤不到你自己的 `loam add`。

## 本地预览

```bash
python -m http.server 8899 --directory demo
# http://127.0.0.1:8899/
```

## 部署

部署由 GitHub Actions 负责，不在本地直传。[.github/workflows/demo.yml](../.github/workflows/demo.yml) 在 push 到 `main` 且改动落在 `demo/**`、`worker/public/**`、`scripts/build-demo.mjs` 时触发，仓库变量 `CF_DEMO=true` 后生效。

首次接入需要一次性的仓库配置（不是部署动作）：

1. Pages 项目 `loam-demo` 已存在；
2. 仓库已有 `CLOUDFLARE_API_TOKEN`（Pages:Edit）与 `CLOUDFLARE_ACCOUNT_ID`；
3. `gh variable set CF_DEMO --body true`，可选 `gh variable set LOAM_DEMO_URL --body https://loam-demo.pages.dev` 打开冒烟测试。

流水线会先跑 `pnpm demo:build`，再用 Guard demo isolation 步骤断言三道锁仍然成立，最后才部署并检查线上 CSP。

## 维护约定

- [app.js](app.js) / [views.js](views.js) / [overlays.js](overlays.js) / [i18n.js](i18n.js) / [styles.css](styles.css) / [index.html](index.html) 都是 `worker/public/` 的副本，由 `pnpm demo:build` 生成，**不要手改**。
- [mock-api.js](mock-api.js) 和 [_headers](_headers) 是本目录独有的源文件，不会被覆盖。
- 改演示数据：编辑 [mock-api.js](mock-api.js) 里的 `FACTS` / `DEVICES` 常量。
- 改前端视觉：改 `worker/public/`，然后重跑 `pnpm demo:build`。

## 会破坏隔离的三件事

1. 删掉 `_headers` 里的 `connect-src 'none'`；
2. 在本目录加 `functions/` 目录（Pages 会把请求转进 Functions）；
3. 把 `mock-api.js` 换成真实 `/v1/*` 调用。

任何一条都会让演示流量重新落到你的账号配额上。