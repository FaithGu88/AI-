#!/usr/bin/env node
// ============================================================================
// AI日报 — 飞书推送 + Obsidian 备份
// ============================================================================
// 1. 拉取 AI HOT 日报 API
// 2. 格式化为飞书富文本 → 推送到飞书群
// 3. 生成 Markdown → 存入 daily/AI日报/ 目录（Obsidian 备份）
//
// Usage:   node push-to-feishu.mjs
// Env:     FEISHU_WEBHOOK (or .env file)
// ============================================================================

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// -- Config -------------------------------------------------------------------

const FEISHU_WEBHOOK = (() => {
  if (process.env.FEISHU_WEBHOOK) return process.env.FEISHU_WEBHOOK;
  try {
    const dotenv = readFileSync(join(import.meta.dirname, '.env'), 'utf-8');
    const m = dotenv.match(/^FEISHU_WEBHOOK=(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  console.error('❌ 缺少 FEISHU_WEBHOOK。请设置环境变量或在项目目录创建 .env 文件。');
  process.exit(1);
})();

const AIHOT_BASE = 'https://aihot.virxact.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 aihot-skill/0.2.0';

// -- Helpers ------------------------------------------------------------------

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

const today = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// -- Data: fetch both sources -------------------------------------------------

async function fetchAihot() {
  // Try daily report first, fall back to selected items
  try {
    return { type: 'daily', data: await fetchJSON(`${AIHOT_BASE}/api/public/daily`) };
  } catch {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return {
      type: 'items',
      data: await fetchJSON(`${AIHOT_BASE}/api/public/items?mode=selected&since=${encodeURIComponent(since)}&take=50`)
    };
  }
}

// -- Formatters: AI HOT → Feishu post blocks ----------------------------------

function formatDailyBlocks(data) {
  const blocks = [];
  const dateStr = data.date || today();
  blocks.push([{ tag: 'text', text: `🤖 AI HOT 日报 — ${dateStr}` }]);
  blocks.push([{ tag: 'text', text: '' }]);

  if (data.lead?.title) {
    blocks.push([{ tag: 'text', text: `📌 ${data.lead.title}` }]);
    if (data.lead.summary) blocks.push([{ tag: 'text', text: data.lead.summary }]);
    if (data.lead.editorNote) blocks.push([{ tag: 'text', text: `💬 ${data.lead.editorNote}` }]);
    blocks.push([{ tag: 'text', text: '' }]);
  }

  let n = 0;
  const sections = data.sections || [];
  const flashSection = sections.find(s => s.label === '快讯' || s.type === 'flash');
  const mainSections = sections.filter(s => s !== flashSection);

  for (const section of mainSections) {
    blocks.push([{ tag: 'text', text: `▎${section.label}` }]);
    for (const item of (section.items || [])) {
      n++;
      const title = item.title || item.title_en || '(无标题)';
      const url = item.sourceUrl || '';
      const source = item.sourceName || '';
      const line = [{ tag: 'text', text: `${n}. ` }];
      if (url) { line.push({ tag: 'a', text: title, href: url }); }
      else { line.push({ tag: 'text', text: title }); }
      if (source) line.push({ tag: 'text', text: ` [${source}]` });
      blocks.push(line);
    }
    blocks.push([{ tag: 'text', text: '' }]);
  }

  if (flashSection?.items?.length) {
    blocks.push([{ tag: 'text', text: '⚡ 快讯' }]);
    for (const item of flashSection.items.slice(0, 10)) {
      const title = item.title || item.title_en || '';
      const url = item.sourceUrl || '';
      const line = [{ tag: 'text', text: '• ' }];
      if (url) { line.push({ tag: 'a', text: title, href: url }); }
      else { line.push({ tag: 'text', text: title }); }
      blocks.push(line);
    }
  }

  return blocks;
}

function formatItemsBlocks(data) {
  const blocks = [];
  const todayStr = today();
  blocks.push([{ tag: 'text', text: `🤖 AI HOT 精选 — ${todayStr}（最近 24 小时）` }]);
  blocks.push([{ tag: 'text', text: '' }]);

  const items = data.items || [];
  if (!items.length) {
    blocks.push([{ tag: 'text', text: '暂无最近 24 小时的 AI 动态。' }]);
    return blocks;
  }

  const catMap = { 'ai-models': '模型发布/更新', 'ai-products': '产品发布/更新', 'industry': '行业动态', 'paper': '论文研究', 'tip': '技巧与观点' };
  const grouped = {};
  for (const item of items) {
    const cat = item.category || 'other';
    (grouped[cat] ??= []).push(item);
  }

  let n = 0;
  for (const [cat, catItems] of Object.entries(grouped)) {
    blocks.push([{ tag: 'text', text: `▎${catMap[cat] || cat}` }]);
    for (const item of catItems) {
      n++;
      const title = item.title || item.title_en || '(无标题)';
      const url = item.url || '';
      const source = item.source || '';
      const line = [{ tag: 'text', text: `${n}. ` }];
      if (url) { line.push({ tag: 'a', text: title, href: url }); }
      else { line.push({ tag: 'text', text: title }); }
      if (source) line.push({ tag: 'text', text: ` [${source}]` });
      blocks.push(line);
    }
    blocks.push([{ tag: 'text', text: '' }]);
  }

  return blocks;
}

// -- Formatter: Markdown for Obsidian backup ----------------------------------

function generateMarkdown(aihotResult) {
  const { type, data } = aihotResult;
  const dateStr = today();
  const lines = [`# AI日报 — ${dateStr}`, '', '> 由 AI日报 自动生成 · 数据来源 [AI HOT](https://aihot.virxact.com)', ''];

  if (type === 'daily') {
    if (data.lead?.title) {
      lines.push(`**${data.lead.title}**`, '');
      if (data.lead.summary) lines.push(data.lead.summary, '');
      if (data.lead.editorNote) lines.push(`> 💬 ${data.lead.editorNote}`, '');
      lines.push('');
    }

    let n = 0;
    const sections = data.sections || [];
    const flash = sections.find(s => s.label === '快讯' || s.type === 'flash');

    for (const section of sections.filter(s => s !== flash)) {
      lines.push(`## ${section.label}`, '');
      for (const item of (section.items || [])) {
        n++;
        const title = item.title || item.title_en || '(无标题)';
        const url = item.sourceUrl || '';
        const source = item.sourceName || '';
        lines.push(`${n}. ${url ? `[${title}](${url})` : title}${source ? ` — ${source}` : ''}`);
      }
      lines.push('');
    }

    if (flash?.items?.length) {
      lines.push('## ⚡ 快讯', '');
      for (const item of flash.items) {
        const title = item.title || item.title_en || '';
        const url = item.sourceUrl || '';
        lines.push(`- ${url ? `[${title}](${url})` : title}`);
      }
      lines.push('');
    }
  } else {
    const catMap = { 'ai-models': '模型发布/更新', 'ai-products': '产品发布/更新', 'industry': '行业动态', 'paper': '论文研究', 'tip': '技巧与观点' };
    const grouped = {};
    for (const item of (data.items || [])) {
      (grouped[item.category || 'other'] ??= []).push(item);
    }

    let n = 0;
    for (const [cat, items] of Object.entries(grouped)) {
      lines.push(`## ${catMap[cat] || cat}`, '');
      for (const item of items) {
        n++;
        const title = item.title || item.title_en || '(无标题)';
        const url = item.url || '';
        const source = item.source || '';
        lines.push(`${n}. ${url ? `[${title}](${url})` : title}${source ? ` — ${source}` : ''}`);
      }
      lines.push('');
    }
  }

  lines.push('---', '', `📬 由 [AI日报](https://github.com/FaithGu88/AI-) 自动推送 · ${new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  return lines.join('\n');
}

function saveMarkdown(content) {
  const dir = join(import.meta.dirname, 'daily', 'AI日报');
  mkdirSync(dir, { recursive: true });
  const filename = `${dir}/${today()}.md`;
  writeFileSync(filename, content, 'utf-8');
  console.log(`📝 日报已备份: ${filename}`);
  return filename;
}

// -- Feishu sender ------------------------------------------------------------

async function sendToFeishu(postPayload) {
  const res = await fetch(FEISHU_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(postPayload)
  });
  const result = await res.json();
  if (result.StatusCode !== 0 && result.code !== 0) {
    throw new Error(`Feishu error: ${JSON.stringify(result)}`);
  }
  return result;
}

// -- Main ---------------------------------------------------------------------

async function main() {
  // Dedup: skip if already pushed today
  const todayFile = join(import.meta.dirname, 'daily', 'AI日报', `${today()}.md`);
  if (existsSync(todayFile)) {
    console.log(`⏭️  今日已推送，跳过 (${todayFile} 已存在)`);
    return;
  }

  // 1. Fetch AI HOT
  console.log('📡 拉取 AI HOT 数据...');
  const aihot = await fetchAihot();
  console.log(`   来源: ${aihot.type}${aihot.type === 'items' ? ' (日报未生成，使用精选回退)' : ''}`);

  // 2. Format Feishu blocks
  const aihotBlocks = aihot.type === 'daily' ? formatDailyBlocks(aihot.data) : formatItemsBlocks(aihot.data);

  // 3. Push to Feishu
  const todayStr = today();
  const title = `📅 ${todayStr} AI日报`;
  const post = {
    msg_type: 'post',
    content: { post: { zh_cn: { title, content: aihotBlocks } } }
  };

  console.log('📤 推送到飞书...');
  await sendToFeishu(post);
  console.log('✅ 飞书推送成功');

  // 4. Save Markdown backup
  const md = generateMarkdown(aihot);
  const filepath = saveMarkdown(md);
  console.log(`✅ 完成 — ${filepath}`);
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
