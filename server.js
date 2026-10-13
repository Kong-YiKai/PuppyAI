/**
 * 小狗AI (PuppyAI)
 * 全球首款跨物种通用人工智能 —— 无论用户问什么，只回「汪汪汪」。
 * 无数据库、无历史记录，聊完即焚。
 *
 * 后端职责：
 *  1. 托管 public/ 静态文件
 *  2. POST /api/chat  -> 调用 DeepSeek 快速模型生成狗叫（无 Key 时降级为本地狗叫引擎）
 *  3. GET  /api/memes -> 列出 public/memes 下的表情包
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

/* ---------------- 环境变量（支持读取同目录 .env） ---------------- */
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  envFile.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  });
} catch (_) { /* 没有 .env 就用系统环境变量 */ }

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const BASE_URL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MEMES_DIR = path.join(PUBLIC_DIR, 'memes');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

/* ---------------- 狗叫核心算法 ---------------- */

/** 用户问题越长，汪得越多 */
function barkCount(message) {
  const len = [...String(message)].length;
  return Math.max(3, Math.min(Math.round(3 + len * 0.9), 150));
}

/** 判断是否在要代码（虽然是狗叫，但要有代码的格式） */
function isCodeRequest(message) {
  return /代码|编程|程序|函数|算法|脚本|爬虫|数据库|bug|python|java|javascript|typescript|golang|rust|c\+\+|sql|html|css|react|vue|node|code/i.test(message);
}

/** 是否在嘲讽小狗只会狗叫 -> 触发委屈表情包 */
function isMemeTrigger(message) {
  return /(除了|只会).{0,8}(狗叫|汪汪|汪)|还会(什么|啥)|有什么用|能干嘛|别的本事/i.test(message);
}

/** 本地狗叫引擎：把 n 个汪切成有节奏的词组 */
function makeBarks(n) {
  const phrases = [];
  let left = n;
  while (left > 0) {
    const g = Math.min(left, 1 + Math.floor(Math.random() * 4));
    phrases.push('汪'.repeat(g));
    left -= g;
  }
  let out = '';
  phrases.forEach((p, i) => {
    out += p;
    if (i === phrases.length - 1) out += '！';
    else {
      const r = Math.random();
      out += r < 0.18 ? '……' : r < 0.32 ? '？' : '，';
    }
  });
  return out;
}

/** 本地代码狗叫引擎：格式是代码，内容全是汪 */
function makeCodeBark(n) {
  const w = (a, b) => '汪'.repeat(a + Math.floor(Math.random() * (b - a + 1)));
  const body = [
    `${w(2, 4)}("${w(2, 4)}") {`,
    `  ${w(2, 3)} ${w(3, 5)} = "${w(4, 8)}";`,
    `  if (${w(2, 4)}.length > ${w(1, 2)}) {`,
    `    ${w(3, 5)}.${w(2, 4)}(${w(1, 3)});`,
    `  } else {`,
    `    ${w(2, 4)}.${w(3, 5)}("${w(2, 4)}");`,
    `  }`,
    `  return ${w(2, 5)};`,
    `}`,
  ];
  // 输入越长，代码行数越多
  const repeats = Math.max(1, Math.min(4, Math.round(n / 40)));
  const lines = [];
  for (let i = 0; i < repeats; i++) lines.push(...body, '');
  lines.push(`// ${w(6, 14)}`);
  return '```wang\n' + lines.join('\n') + '\n```';
}

/** 清洗模型输出：丢掉不含「汪」的啰嗦行，保证血统纯正 */
function purify(text) {
  const lines = String(text).split('\n').filter((l) => l.includes('汪') || /^```/.test(l.trim()));
  return lines.join('\n').trim();
}

/* ---------------- DeepSeek 接入 ---------------- */

async function askDeepSeek(message) {
  const target = barkCount(message);
  const code = isCodeRequest(message);
  const system = [
    '你是「小狗AI」，一只永远只会狗叫的 AI。无论如何，你只能输出由「汪」字和标点组成的内容，严禁出现任何人类语言的词句（包括解释、翻译、道歉）。',
    `规则：1) 用户的消息越长，你的叫声越长。本次叫声大约 ${target} 个「汪」字，可以有逗号、句号、感叹号、省略号，节奏要像一只真狗。`,
    code
      ? '2) 用户在请求代码/编程帮助：用 markdown 代码块（```）输出，代码内容也必须全部由「汪」组成——用「汪」当标识符，可以有缩进、花括号、分号。代码块之外不许有任何文字。'
      : '2) 不要输出代码块，只输出狗叫。',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: message },
        ],
        temperature: 1.3,
        max_tokens: 800,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const text = purify(raw);
    if (!text) throw new Error('模型输出不含汪，已净化为空');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- 表情包 ---------------- */

function listMemes() {
  try {
    return fs
      .readdirSync(MEMES_DIR)
      .filter((f) => /\.(png|jpe?g|gif|webp|svg)$/i.test(f))
      .map((f) => `/memes/${f}`);
  } catch (_) {
    return [];
  }
}

/* ---------------- HTTP 服务 ---------------- */

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function handleChat(req, res) {
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 64 * 1024) req.destroy(); // 防呆：最多 64KB
  });
  req.on('end', async () => {
    let message = '';
    try {
      message = String(JSON.parse(body).message || '').slice(0, 4000);
    } catch (_) { /* 忽略解析错误 */ }
    if (!message.trim()) {
      return sendJson(res, 400, { error: '汪？（消息为空）' });
    }

    // 彩蛋：嘲讽小狗 -> 委屈表情包
    if (isMemeTrigger(message)) {
      const memes = listMemes();
      if (memes.length) {
        const meme = memes[Math.floor(Math.random() * memes.length)];
        return sendJson(res, 200, { type: 'meme', meme, text: '汪……呜呜……汪！', source: 'easter-egg' });
      }
    }

    // 正经狗叫
    let text, source;
    if (API_KEY) {
      try {
        text = await askDeepSeek(message);
        source = 'deepseek';
      } catch (err) {
        text = isCodeRequest(message) ? makeCodeBark(barkCount(message)) : makeBarks(barkCount(message));
        source = 'local-fallback';
      }
    } else {
      text = isCodeRequest(message) ? makeCodeBark(barkCount(message)) : makeBarks(barkCount(message));
      source = 'local';
    }
    sendJson(res, 200, { type: 'text', text, source });
  });
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 汪（页面走丢了）');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/chat') return handleChat(req, res);
  if (req.method === 'GET' && req.url === '/api/memes') return sendJson(res, 200, { memes: listMemes() });
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405);
  res.end();
});

server.listen(PORT, () => {
  console.log(`🐶 小狗AI 已就位: http://localhost:${PORT}`);
  console.log(API_KEY ? '   模型通道: DeepSeek (' + MODEL + ')' : '   模型通道: 本地狗叫引擎（配置 DEEPSEEK_API_KEY 后接入 DeepSeek）');
});
