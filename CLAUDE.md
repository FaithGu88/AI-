# AI日报

AI行业每日资讯聚合与简报项目。

## 项目定位
自动化收集、整理、展示AI领域的最新动态，每日早 8:15 推送到飞书。

## 核心功能
- AI HOT 日报（aihot.virxact.com）— 覆盖模型发布、产品更新、行业动态、论文、技巧观点
- Follow Builders 摘要 — 追踪 AI 领域头部 Builders 的 X/Twitter 和播客动态
- 飞书自动推送 — 每日 8:15（北京时间）推送到飞书群机器人

## 文件结构
- `push-to-feishu.mjs` — 主推送脚本：拉取 AI HOT + Follow Builders → 格式化为飞书富文本 → 推送
- 飞书 Webhook: 已配置

## 定时任务
- Cron: `15 8 * * *`（每天 8:15 AM 北京时间）
- 持久化到 `.claude/scheduled_tasks.json`
- **注意**：Cron 任务 7 天后自动过期，需重新创建；仅 Claude Code 运行时才会触发

## 依赖
- Node.js（已安装）
- 飞书自定义机器人 Webhook（已配置）
- AI HOT API（公开，无需 Key）
- Follow Builders feed（公开，无需 Key）
