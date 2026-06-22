#!/usr/bin/env node
// ============================================================================
// AI日报 — 飞书推送脚本
// ============================================================================
// 拉取 AI HOT 日报 + Follow Builders 摘要，格式化为飞书富文本推送
//
// Usage: node push-to-feishu.mjs
// Env:   FEISHU_WEBHOOK (optional, has default)
// ============================================================================

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// -- Config -------------------------------------------------------------------

// Read webhook from env var (GitHub Actions) or local .env file (not committed)
let FEISHU_WEBHOOK = process.env.FEISHU_WEBHOOK;
if (!FEISHU_WEBHOOK) {
  try {
    const dotenv = readFileSync(join(import.meta.dirname, '.env'), 'utf-8');
    for (const line of dotenv.split('\n')) {
      const m = line.match(/^FEISHU_WEBHOOK=(.+)$/);
      if (m) { FEISHU_WEBHOOK = m[1].trim(); break; }
    }
  } catch {}
}
if (!FEISHU_WEBHOOK) {
  console.error('❌ 缺少 FEISHU_WEBHOOK。请设置环境变量或在项目目录创建 .env 文件。');
  process.exit(1);
}

const AIHOT_BASE = 'https://aihot.virxact.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 aihot-skill/0.2.0';

const FOLLOW_DIR = join(homedir(), '.follow-builders');
const DIGEST_FILE = join(FOLLOW_DIR, 'latest-digest.txt');

// -- Helpers ------------------------------------------------------------------

async function fetchJSON(url, opts = {}) {
  const headers = { 'User-Agent': UA, ...opts.headers };
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

function formatTime(iso) {
  const d = new Date(iso);
  const beijing = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const h = beijing.getUTCHours().toString().padStart(2, '0');
  const m = beijing.getUTCMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

// -- Feishu post builder ------------------------------------------------------

// NOTE: Feishu custom bot webhook does NOT support "style" (bold/italic).
// Use emoji/visual markers instead. "a" tags for links are supported.

function buildPost(title, contentBlocks) {
  return {
    msg_type: 'post',
    content: {
      post: {
        zh_cn: { title, content: contentBlocks }
      }
    }
  };
}

// -- AI HOT: fetch daily report -----------------------------------------------

async function fetchAihotDaily() {
  const url = `${AIHOT_BASE}/api/public/daily`;
  const data = await fetchJSON(url);

  const blocks = [];

  // Header
  const dateStr = data.date || new Date().toISOString().slice(0, 10);
  blocks.push([{ tag: 'text', text: `🤖 AI HOT 日报 — ${dateStr}` }]);
  blocks.push([{ tag: 'text', text: '' }]);

  // Lead
  if (data.lead?.title) {
    blocks.push([{ tag: 'text', text: `📌 ${data.lead.title}` }]);
    if (data.lead.summary) {
      blocks.push([{ tag: 'text', text: data.lead.summary }]);
    }
    if (data.lead.editorNote) {
      blocks.push([{ tag: 'text', text: `💬 ${data.lead.editorNote}` }]);
    }
    blocks.push([{ tag: 'text', text: '' }]);
  }

  // Sections
  if (data.sections?.length > 0) {
    let n = 0;
    const flashSection = data.sections.find(s => s.label === '快讯' || s.type === 'flash');
    const mainSections = data.sections.filter(s => s !== flashSection);

    for (const section of mainSections) {
      blocks.push([{ tag: 'text', text: `▎${section.label}` }]);
      const items = section.items || [];
      for (const item of items) {
        n++;
        const title = item.title || item.title_en || '(无标题)';
        const url = item.url || '';

        const line = [{ tag: 'text', text: `${n}. ` }];
        if (url) {
          line.push({ tag: 'a', text: title, href: url });
        } else {
          line.push({ tag: 'text', text: title });
        }
        if (item.source) {
          line.push({ tag: 'text', text: ` [${item.source}]` });
        }
        blocks.push(line);
      }
      blocks.push([{ tag: 'text', text: '' }]);
    }

    // Flash section
    if (flashSection && flashSection.items?.length > 0) {
      blocks.push([{ tag: 'text', text: '⚡ 快讯' }]);
      for (let i = 0; i < Math.min(flashSection.items.length, 10); i++) {
        const item = flashSection.items[i];
        const title = item.title || item.title_en || '';
        const url = item.url || '';
        const line = [{ tag: 'text', text: '• ' }];
        if (url) {
          line.push({ tag: 'a', text: title, href: url });
        } else {
          line.push({ tag: 'text', text: title });
        }
        blocks.push(line);
      }
    }
  }

  // Link to full daily
  if (data.shareUrl) {
    blocks.push([{ tag: 'text', text: '' }]);
    blocks.push([{ tag: 'text', text: '📎 ' }, { tag: 'a', text: '查看完整日报', href: data.shareUrl }]);
  }

  return blocks;
}

// Fallback: fetch 精选 items when daily not yet available (before 08:00 BJT)
async function fetchAihotItems() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const url = `${AIHOT_BASE}/api/public/items?mode=selected&since=${encodeURIComponent(since)}&take=50`;
  const data = await fetchJSON(url);

  const blocks = [];
  const today = new Date().toISOString().slice(0, 10);
  blocks.push([{ tag: 'text', text: `🤖 AI HOT 精选 — ${today}（最近 24 小时）` }]);
  blocks.push([{ tag: 'text', text: '' }]);

  const items = data.items || [];
  if (items.length === 0) {
    blocks.push([{ tag: 'text', text: '暂无最近 24 小时的 AI 动态。' }]);
  } else {
    const catMap = {
      'ai-models': '模型发布/更新',
      'ai-products': '产品发布/更新',
      'industry': '行业动态',
      'paper': '论文研究',
      'tip': '技巧与观点'
    };
    const grouped = {};
    for (const item of items) {
      const cat = item.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    }

    let n = 0;
    for (const [cat, catItems] of Object.entries(grouped)) {
      const label = catMap[cat] || cat;
      blocks.push([{ tag: 'text', text: `▎${label}` }]);
      for (const item of catItems) {
        n++;
        const title = item.title || item.title_en || '(无标题)';
        const url = item.url || '';
        const line = [{ tag: 'text', text: `${n}. ` }];
        if (url) {
          line.push({ tag: 'a', text: title, href: url });
        } else {
          line.push({ tag: 'text', text: title });
        }
        if (item.source) {
          line.push({ tag: 'text', text: ` [${item.source}]` });
        }
        blocks.push(line);
      }
      blocks.push([{ tag: 'text', text: '' }]);
    }
  }

  blocks.push([{ tag: 'text', text: '📎 ' }, { tag: 'a', text: '查看 AI HOT 精选', href: 'https://aihot.virxact.com' }]);

  return blocks;
}

// -- Follow Builders -----------------------------------------------------------

async function fetchBuilderHighlights() {
  if (existsSync(DIGEST_FILE)) {
    const text = readFileSync(DIGEST_FILE, 'utf-8').trim();
    if (text) return text;
  }
  return null;
}

function formatBuilderBlocks(digestText) {
  if (!digestText) return [];
  const blocks = [];
  blocks.push([{ tag: 'text', text: '' }]);
  blocks.push([{ tag: 'text', text: '👷 AI Builders 今日摘要' }]);

  const lines = digestText.split('\n').filter(l => l.trim());
  for (const line of lines.slice(0, 80)) {
    blocks.push([{ tag: 'text', text: line }]);
  }
  return blocks;
}

// -- Send to Feishu ------------------------------------------------------------

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
  console.log('📡 拉取 AI HOT 日报...');

  let aihotBlocks;
  try {
    aihotBlocks = await fetchAihotDaily();
  } catch (err) {
    console.log(`  日报不可用 (${err.message})，使用精选条目回退...`);
    aihotBlocks = await fetchAihotItems();
  }

  console.log('📡 检查 Follow Builders 摘要...');
  const builderText = await fetchBuilderHighlights();
  const builderBlocks = formatBuilderBlocks(builderText);

  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
  const title = `📅 ${dateStr} AI日报`;

  const contentBlocks = [
    ...aihotBlocks,
    ...builderBlocks,
    [{ tag: 'text', text: '' }],
    [{ tag: 'text', text: `📬 由 AI日报 自动推送 | ${today.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}` }]
  ];

  const post = buildPost(title, contentBlocks);

  console.log('📤 推送到飞书...');
  await sendToFeishu(post);

  console.log('✅ 推送成功');
}

main().catch(err => {
  console.error('❌ 推送失败:', err.message);
  process.exit(1);
});
