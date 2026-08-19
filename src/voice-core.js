// voice-core - 语音助手正式插件（注入 + 输出）
// host 插件：轮询 commands.txt 注入语音指令 + agent 回复语音朗读
// （回滚回声过滤：提示音回声改由 voice-daemon 端「提示音后 1.5s 锁识别」处理）
import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, appendFileSync } from 'fs';
import { execFile } from 'child_process';
import { createRequire } from 'module';

// voice-core 是 ESM 模块, 用 createRequire 才能 require CommonJS 的 sherpa-onnx-node
const esmRequire = createRequire(import.meta.url);

const HOME = homedir();
const CMD_FILE = join(HOME, '.dsh', 'voice', 'commands.txt');
const DIAG_LOG = join(HOME, '.dsh', 'voice', 'voice-core.log');
function diag(...args) {
  try {
    appendFileSync(DIAG_LOG, '[' + new Date().toISOString() + '] ' + args.join(' ') + '\n');
  } catch (e) {}
}
const PLAY_WAV = join(HOME, '.dsh', 'voice-plugin', 'play-wav.ps1');
const FIXED = join(HOME, '.dsh', 'voice-plugin', 'fixed');
const VITS_DIR = join(HOME, '.dsh', 'voice-plugin', 'tts-models', 'vits-zh-ll');
const NODE = join('C:', 'Program Files', 'nodejs', 'node.exe');
const WAV_OUT = join(HOME, '.dsh', 'voice', 'tts-speak.wav');

function playFixed(name) {
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PLAY_WAV, join(FIXED, name)], { timeout: 6000 }, () => {});
}

// 打开 dsh 网页：已有 DeepSeek Harness 窗口则只激活（不新开页面），否则才打开新页面
function openOrFocusDash() {
  const ps = [
    '-NoProfile', '-Command',
    // 找标题含 DeepSeek Harness 的浏览器窗口 pid，有则激活并退出 0，无则退出 1
    // （只依赖退出码，不输出文本）
    "$w = Get-Process | Where-Object { $_.MainWindowTitle -match 'DeepSeek Harness' -and $_.ProcessName -match 'edge|chrome|firefox|brave|opera' } | Select-Object -First 1; " +
    "if ($w) { (New-Object -ComObject WScript.Shell).AppActivate($w.Id) | Out-Null; exit 0 } else { exit 1 }",
  ];
  execFile('powershell.exe', ps, { windowsHide: true, timeout: 5000 }, (err) => {
    // 激活失败（无窗口）时，才用默认浏览器打开新页面
    if (err && err.code === 1) {
      try {
        execFile('cmd.exe', ['/c', 'start', '', 'http://127.0.0.1:3080'], { windowsHide: true, timeout: 5000 }, () => {});
      } catch {}
    }
  });
}

const DIGITS_CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function intToCn(num) {
  if (num === 0) return '零';
  const units = ['', '十', '百', '千'];
  const bigUnits = ['', '万', '亿'];
  const neg = num < 0;
  let n = Math.abs(num);
  let result = '';
  let bigIdx = 0;
  while (n > 0) {
    let part = n % 10000;
    let partStr = '';
    if (part === 0) {
      partStr = '零';
    } else {
      let p = part;
      let u = 0;
      let lastZero = false;
      while (p > 0) {
        const d = p % 10;
        if (d === 0) {
          if (!lastZero && partStr) partStr = '零' + partStr;
          lastZero = true;
        } else {
          partStr = DIGITS_CN[d] + units[u] + partStr;
          lastZero = false;
        }
        p = Math.floor(p / 10);
        u++;
      }
      if (part >= 10 && part < 20 && result === '' && bigIdx === 0) {
        partStr = partStr.replace(/^一/, '');
      }
    }
    result = partStr + bigUnits[bigIdx] + result;
    n = Math.floor(n / 10000);
    bigIdx++;
  }
  result = result.replace(/零+/g, '零').replace(/零$/g, '');
  return (neg ? '负' : '') + result;
}

function numToCn(num) {
  if (Number.isInteger(num)) return intToCn(num);
  const parts = String(num).split('.');
  const intPart = intToCn(parseInt(parts[0], 10));
  const fracPart = parts[1] ? '点' + parts[1].split('').map((d) => DIGITS_CN[parseInt(d, 10)]).join('') : '';
  return intPart + fracPart;
}

// 阿拉伯数字/符号 → 中文读音 (vits 不认阿拉伯数字, OOV 会被静默忽略)
function digitsToCn(text) {
  let s = String(text);
  s = s.replace(/(\d+(?:\.\d+)?)%/g, (m, n) => '百分之' + numToCn(parseFloat(n)));
  s = s.replace(/℃|°C/g, '摄氏度')
       .replace(/°(?=\d)/g, '度')
       .replace(/km\/h/g, '公里每小时')
       .replace(/m\/s/g, '米每秒');
  s = s.replace(/-(\d+(?:\.\d+)?)/g, (m, n) => '负' + numToCn(parseFloat(n)));
  s = s.replace(/(\d+\.\d+)/g, (m, n) => numToCn(parseFloat(n)));
  s = s.replace(/(\d+)/g, (m, n) => {
    const v = parseInt(n, 10);
    if (v > 99999999) return m;
    return intToCn(v);
  });
  s = s.replace(/[°]/g, '度').replace(/\+/g, '正');
  return s;
}

function cleanForSpeech(text) {
  return digitsToCn(String(text))
    .replace(/```dsh-ui[\s\S]*?```/g, ' ')
    .replace(/^\|.*\|$/gm, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*#`>]+/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

// TTS 模型单例: voice-core 进程内只加载一次, 后续合成秒出
let ttsInstance = null;
function getTts() {
  if (ttsInstance) return ttsInstance;
  const sherpa = esmRequire(join(HOME, '.dsh', 'voice-plugin', 'node_modules', 'sherpa-onnx-node'));
  ttsInstance = new sherpa.OfflineTts({
    model: {
      vits: {
        model: join(VITS_DIR, 'model.onnx'),
        tokens: join(VITS_DIR, 'tokens.txt'),
        lexicon: join(VITS_DIR, 'lexicon.txt'),
      },
    },
    numThreads: 2,
    provider: 'cpu',
  });
  return ttsInstance;
}

function speakText(text) {
  const clean = cleanForSpeech(text);
  if (!clean) return;
  // 进程内合成（模型单例，只加载一次，后续秒出），写 wav 后 play-wav.ps1 播放
  try {
    const sherpa = esmRequire(join(HOME, '.dsh', 'voice-plugin', 'node_modules', 'sherpa-onnx-node'));
    const tts = getTts();
    const audio = tts.generate({ text: clean, sid: 0, speed: 1.1 });
    sherpa.writeWave(WAV_OUT, { samples: audio.samples, sampleRate: audio.sampleRate });
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PLAY_WAV, WAV_OUT], { timeout: 30000 }, () => {});
  } catch (e) {
    diag('speakText 失败:', String(e));
  }
}

function extractText(ev) {
  const data = ev && ev.data;
  const msg = (data && (data.message || data.assistantMessage)) || data || {};
  const content = msg.content || (data && data.content);
  if (Array.isArray(content)) {
    return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
  }
  return '';
}

export const name = 'voice-core';
export const inject = ['agents', 'timer', 'fs'];

export function apply(ctx) {
  const agents = ctx.agents;
  const timer = ctx.timer;
  const fs = ctx.fs;

  // ---- 语音指令注入 ----
  let lastLine = 0;
  let initialized = false;   // 首次轮询只同步行数，不重放历史指令
  const injectDisposer = timer.interval(async () => {
    try {
      const target = await fs.resolve(CMD_FILE);
      const text = await fs.readText(target);
      const lines = text.split('\n').filter((l) => l.trim().length > 0);
      if (!initialized) {
        initialized = true;
        lastLine = lines.length;
        return;
      }
      if (lines.length > lastLine) {
        const newest = lines[lines.length - 1];
        lastLine = lines.length;
        const cmd = newest.replace(/^\[[^\]]+\]\s*/, '').trim();
        if (cmd && cmd !== '（无语音内容）' && cmd !== '无') {
          try {
            // 每条语音指令都开一个独立新会话（不注入当前聊天会话）
            const existing = agents.list();
            // 以「非语音」的主会话为继承源（语音会话自身无完整工具，不能作为父）
            const lastAgent = [...existing].reverse().find((a) => a && !String(a.id || '').startsWith('voice-'))
              || existing[existing.length - 1];
            const meta = {};
            // {{cwd}} 变量取自 session.header.cwd，必须继承当前会话的工作目录
            const cwd = lastAgent && lastAgent.session && lastAgent.session.header && lastAgent.session.header.cwd;
            if (cwd) meta.cwd = cwd;
            // 继承当前会话的 agent 预设（决定工具集/权限/人设），否则新会话是受限默认预设（无本地终端）
            const agentPreset = lastAgent && lastAgent.session && lastAgent.session.header && lastAgent.session.header.agentPreset;
            if (agentPreset) meta.agentPreset = agentPreset;
            const sessionId = 'voice-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            const parentCtx = lastAgent && lastAgent.ctx;
            diag('注入: 指令=', cmd.slice(0, 30), '| 父会话=', lastAgent ? lastAgent.id : '(无)', '| sessionId=', sessionId);
            const handle = await agents.create({
              sessionId,
              meta,
              // 继承当前会话的模型配置，否则 persona 的 {{model}} 变量无值导致运行失败
              agentOptions: lastAgent && lastAgent.options
                ? { provider: lastAgent.options.provider, model: lastAgent.options.model }
                : undefined,
              // 继承主会话的预设组合（工具集/prompt），否则新会话只有受限默认工具
              setup: (agentCtx) => {
                if (parentCtx) agentCtx.get('agentPresets')?.composeFrom(agentCtx, parentCtx);
              },
            });
            const msg = {
              id: 'voice-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
              role: 'user',
              content: [{
                type: 'text',
                text: '【语音指令】' + cmd +
                  '\n（语音指令规则：执行后用一行「【语音播报】」开头给出 20-50 字口语化总结，直接播报结果，别啰嗦。' +
                  '查天气：运行 node ' + join(HOME, '.dsh', 'voice-plugin', 'weather.cjs') + ' 参数 ，参数 0=今天 1=明天 2=后天，按用户问的天数传。）',
              }],
              source: { kind: 'user' },
            };
            handle.agent.send(msg, 'next-turn', true);
            diag('已 send 语音消息 →', sessionId);
            console.log('[voice-core] 语音指令 → 新会话', sessionId, ':', cmd);
            // 收到语音指令时打开/激活 dsh 网页：已有窗口则只激活，无窗口才新开
            try {
              openOrFocusDash();
            } catch {}
          } catch (e) {
            console.error('[voice-core] 语音新会话失败:', String(e));
          }
        }
      }
    } catch (e) {
      console.error('[voice-core] 注入错误:', String(e));
    }
  }, 1000);
  ctx.effect(() => injectDisposer);

  // ---- 语音输出（朗读语音指令的回复）----
  // 按 agent id 记录 running 状态：多条语音会话可与文字会话并行，互不串扰
  const runningAgents = new Map();
  const statusDisposer = ctx.on('agent/status', (payload) => {
    try {
      const status = payload && payload.status;
      const agent = payload && payload.agent;
      const agentId = agent && (agent.id || agent.session && agent.session.id);
      if (!agentId) return;
      diag('agent/status:', agentId, '→', status);
      if (status === 'running') { runningAgents.set(agentId, true); return; }
      if (status === 'idle' && runningAgents.get(agentId)) {
        runningAgents.delete(agentId);
        diag('idle 触发朗读检查:', agentId);
        const session = agent && agent.session;
        const events = session && session.events;
        diag('events 数量:', events ? events.length : '(无)');
        if (!events || !events.length) return;
        // 诊断: dump 事件尾部结构
        try {
          const tail = events.slice(-12).map((ev) => {
            const d = ev && ev.data;
            const msg = (d && (d.message || d.assistantMessage)) || d || {};
            const content = msg.content;
            let brief = '';
            if (Array.isArray(content)) {
              brief = content.map((b) => b ? (b.type + (b.text ? ':' + String(b.text).slice(0, 20) : b.name ? ':' + b.name : '')) : '').join('|');
            }
            return (ev.type || '?') + (brief ? '<' + brief.slice(0, 60) + '>' : '');
          });
          diag('事件尾部: ', JSON.stringify(tail));
        } catch (e) {
          diag('dump 失败:', String(e));
        }
        // 只对语音会话朗读（按 id 前缀隔离，不碰普通会话）
        if (!String(agentId).startsWith('voice-')) return;
        // 从后往前找最后一条 assistant/message，取含文本的回复朗读
        // （语音会话只处理一条指令，最后一条 assistant 文本就是该指令的回复；
        //   事件尾部是 assistant/message → step/end → turn/end，没有尾部 user 消息，不能依赖它匹配）
        let lastAssistant = '';
        for (let i = events.length - 1; i >= 0; i--) {
          const ev = events[i];
          if (!ev) continue;
          if (ev.type === 'assistant/message') {
            const t = extractText(ev);
            if (t) {
              lastAssistant = t;
              break;
            }
          }
        }
        if (!lastAssistant) {
          diag('朗读决策: 未找到 assistant 文本');
          return;
        }
        // 优先提取「【语音播报】」后的口语化总结；没有标记则用整条回复
        const m = lastAssistant.match(/【语音播报】\s*([\s\S]*)/);
        const speech = m ? m[1].trim() : lastAssistant;
        diag('朗读决策: lastAssistant=', lastAssistant.slice(0, 60), '| 提取后=', speech.slice(0, 60));
        if (speech) {
          console.log('[voice-core] 语音指令回复，朗读');
          speakText(speech);
        }
      }
    } catch (e) {
      console.error('[voice-core] 输出错误:', String(e));
    }
  });
  ctx.effect(() => statusDisposer);
}
