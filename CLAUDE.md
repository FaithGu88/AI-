# AI日报

AI行业每日资讯聚合与简报项目。

## 项目定位
自动化收集、整理、展示AI领域的最新动态，每日早 8:15（北京时间）推送到飞书。

## 核心功能
- AI HOT 日报（aihot.virxact.com）— 覆盖模型发布、产品更新、行业动态、论文、技巧观点
- Follow Builders 摘要 — 追踪 AI 领域头部 Builders 的 X/Twitter 和播客动态
- 飞书自动推送 — 每日 8:15 推送到飞书群机器人

## 文件结构
- `push-to-feishu.mjs` — 主推送脚本：拉取 AI HOT + Follow Builders → 格式化为飞书富文本 → 推送
- `.github/workflows/daily-push.yml` — GitHub Actions 定时触发（UTC 00:15）
- `.env` — 飞书 Webhook URL（不提交到 Git）

## 部署方式
- **GitHub Actions**（主力）：每天 8:15 云端自动运行，电脑关机也不影响
- 飞书 Webhook 通过 GitHub Secrets 注入，不暴露在代码中
- 仓库：https://github.com/FaithGu88/AI-
