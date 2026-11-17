# 0002 — 只做 Cloudflare 后端

- **背景**：单人使用量极小；免费层有 Workers / D1 / 限流 binding /（可选）R2、Vectorize。
- **决策**：真相源是 Workers + D1，不抽象 Storage 接口，不做第二后端。
- **代价**：受 D1 行读写配额与 10 ms CPU 限制；中国大陆访问有延迟（用 5 分钟读缓存 + 写 outbox 缓解）。
- **替代**：自建 SQLite/Postgres（运维成本、离线与鉴权全自建）；Supabase/Neon（冷启动与免费额度不同）。
- **何时重审**：月用量逼近免费层 5% 以上，或需要事务/全文检索能力 D1 给不了。