# 0004 — 静态 per-device Bearer，不用 OAuth

- **背景**：单人、2+ 设备；OAuth device grant / refresh / SSO 的复杂度全落在一次性发放上。
- **决策**：`/v1/activate` 用 ADMIN_TOKEN 发放长期 bearer；设备侧只存一个 token，支持 revoke / rotate。
- **代价**：token 泄漏要靠手动撤销；没有过期时间与自动续期。
- **替代**：OAuth Device Grant（仍是 bearer，只换发放方式，v1.1 可选）；CF Access Service Token（可叠加保护 /activate）。
- **何时重审**：多用户、需要第三方授权或合规要求短期凭证时。