/* ============================================================
   小狗AI 前端逻辑
   - 聊天：发送 -> 后端狗叫 -> 渲染（支持代码块 / 表情包）
   - 通话：模拟语音通话，AI 只会汪汪汪（含 Web Audio 狗叫合成）
   ============================================================ */

const $ = (sel) => document.querySelector(sel);

const messagesEl = $('#messages');
const formEl = $('#chatForm');
const inputEl = $('#input');
const sendBtn = $('#btnSend');
const peerStatus = $('#peerStatus');

/* ---------------- 聊天 ---------------- */

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/** 把狗叫文本渲染成 HTML（支持 ``` 代码块） */
function renderBarkText(text) {
  const frag = document.createDocumentFragment();
  const parts = String(text).split(/(```[\s\S]*?```)/g);
  parts.forEach((part) => {
    if (!part) return;
    if (part.startsWith('```')) {
      const code = part.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '');
      const pre = document.createElement('pre');
      pre.textContent = code;
      frag.appendChild(pre);
    } else {
      const span = document.createElement('span');
      span.textContent = part;
      frag.appendChild(span);
    }
  });
  return frag;
}

function addMessage(role, content, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'ai' ? '🐶' : '🧑';
  wrap.appendChild(avatar);

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (opts.meme) {
    bubble.appendChild(renderBarkText(content));
    const img = document.createElement('img');
    img.className = 'meme-img';
    img.src = opts.meme;
    img.alt = '委屈的小狗';
    bubble.appendChild(img);
  } else {
    bubble.appendChild(renderBarkText(content));
  }

  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

function showTyping() {
  const wrap = document.createElement('div');
  wrap.className = 'msg ai typing';
  wrap.id = 'typingMsg';
  wrap.innerHTML = `<div class="msg-avatar">🐶</div>
    <div class="bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
  messagesEl.appendChild(wrap);
  scrollToBottom();
  peerStatus.textContent = '正在组织狗叫…';
}

function hideTyping() {
  $('#typingMsg')?.remove();
  peerStatus.textContent = '在线 · 随时准备汪';
}

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;

  addMessage('user', text);
  inputEl.value = '';
  sendBtn.disabled = true;
  showTyping();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    // 让「正在输入」至少停留一小会儿，更像真狗在思考
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 700));
    hideTyping();

    if (!res.ok) {
      addMessage('ai', data.error || '汪？（出了一点点问题）');
    } else if (data.type === 'meme') {
      addMessage('ai', data.text || '汪……', { meme: data.meme });
    } else {
      addMessage('ai', data.text);
    }
  } catch (err) {
    hideTyping();
    addMessage('ai', '汪……汪汪？（网络好像被狗啃了，请稍后再试）');
  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
});

/* ---------------- 滚动交互 ---------------- */

$('#btnStart').addEventListener('click', () => {
  document.getElementById('chat').scrollIntoView({ behavior: 'smooth' });
  setTimeout(() => inputEl.focus(), 600);
});

/* ---------------- 语音通话 ---------------- */

const callOverlay = $('#callOverlay');
const callStatus = $('#callStatus');
const callTimer = $('#callTimer');
const callCaption = $('#callCaption');
const callAvatar = $('#callAvatar');
const wave = $('#wave');
const btnMute = $('#btnMute');

let audioCtx = null;
let callStart = 0;
let timerInt = null;
let barkInt = null;
let muted = false;

/**
 * 播放狗叫：优先播放真实语音音频（tools/gen_barks.py 离线生成），
 * 随机挑一条，清脆干净、条条不同。音频加载失败时降级为合成狗叫兜底。
 */
const BARK_FILES = [
  '/barks/bark-01.wav',
  '/barks/bark-02.wav',
  '/barks/bark-03.wav',
  '/barks/bark-04.wav',
  '/barks/bark-05.wav',
  '/barks/bark-06.wav',
];

function playBark() {
  if (muted) return;
  const src = BARK_FILES[Math.floor(Math.random() * BARK_FILES.length)];
  const audio = new Audio(src);
  audio.volume = 0.9;
  audio.play().catch(() => playSynthBark()); // 浏览器拦截或文件缺失时兜底
}

/** 兜底：Web Audio 合成狗叫（音频文件不可用时才用） */
function playSynthBark(volume = 0.5) {
  if (muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    const t = t0;
    const dur = 0.15;
    const src = audioCtx.createOscillator();
    src.type = 'sawtooth';
    const f0 = 400 + Math.random() * 140;
    src.frequency.setValueAtTime(f0, t);
    src.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + 0.1);
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const out = audioCtx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(volume, t + 0.008);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp); lp.connect(out); out.connect(audioCtx.destination);
    src.start(t);
    src.stop(t + dur + 0.05);
  } catch (_) { /* 浏览器不让出声就安静地汪 */ }
}

function randomBarkText() {
  const pool = [
    '汪！', '汪汪！', '汪汪汪！', '汪……汪！', '汪汪——！',
    '汪？汪！', '汪汪汪汪！', '汪！汪！汪！', '嗷呜……汪！',
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

function barkOnce() {
  callCaption.textContent = randomBarkText();
  callAvatar.classList.remove('barking');
  void callAvatar.offsetWidth; // 重触发动画
  callAvatar.classList.add('barking');
  wave.classList.add('active');
  playBark();
  setTimeout(() => wave.classList.remove('active'), 600);
}

function fmtTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function startCall() {
  callOverlay.classList.remove('hidden');
  callStatus.textContent = '正在呼叫 小狗AI …';
  callCaption.textContent = '汪…';
  callTimer.textContent = '00:00';
  muted = false;
  btnMute.classList.remove('muted');
  btnMute.textContent = '🎙️';

  // 1.2 秒后"接通"
  setTimeout(() => {
    if (callOverlay.classList.contains('hidden')) return;
    callStatus.textContent = '通话中 · 对方只会汪汪汪';
    callStart = Date.now();
    timerInt = setInterval(() => {
      callTimer.textContent = fmtTime(Math.floor((Date.now() - callStart) / 1000));
    }, 1000);
    barkOnce();
    barkInt = setInterval(barkOnce, 1800 + Math.random() * 1500);
  }, 1200);
}

function endCall() {
  clearInterval(timerInt);
  clearInterval(barkInt);
  timerInt = barkInt = null;
  const dur = callStart ? Math.floor((Date.now() - callStart) / 1000) : 0;
  callOverlay.classList.add('hidden');
  callStart = 0;
  if (dur > 0) {
    addMessage('ai', `汪！汪汪……（通话结束，时长 ${fmtTime(dur)}，小狗挂电话前又对你汪了一声）`);
  }
}

$('#btnCall').addEventListener('click', startCall);
$('#btnCallNav').addEventListener('click', startCall);
$('#btnCallHero').addEventListener('click', startCall);
$('#btnHangup').addEventListener('click', endCall);
btnMute.addEventListener('click', () => {
  muted = !muted;
  btnMute.classList.toggle('muted', muted);
  btnMute.textContent = muted ? '🔇' : '🎙️';
});

// 点遮罩空白处也可挂断
callOverlay.addEventListener('click', (e) => {
  if (e.target === callOverlay) endCall();
});
