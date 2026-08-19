// voice-daemon.cjs - sherpa-onnx 本地流式语音识别 v2（正确 API）
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sherpa = require(path.join(os.homedir(), '.dsh', 'voice-plugin', 'node_modules', 'sherpa-onnx-node'));

const HOME = os.homedir();
const MODELS = path.join(HOME, '.dsh', 'voice-plugin', 'models');
const CMD_FILE = path.join(HOME, '.dsh', 'voice', 'commands.txt');
const MIC = "@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\\wave_{1E9C5CC2-7445-49FF-8D6F-F3D879EB235D}";

function findFfmpeg() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(base)) return 'ffmpeg';
  const walk = (dir, depth) => {
    if (depth > 6) return null;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name === 'ffmpeg.exe') return p;
      if (e.isDirectory()) { const r = walk(p, depth + 1); if (r) return r; }
    }
    return null;
  };
  return walk(base, 0) || 'ffmpeg';
}

const FFMPEG = findFfmpeg();
const FFPLAY = FFMPEG.replace(/ffmpeg\.exe$/i, 'ffplay.exe');   // ffplay 与 ffmpeg 同目录，启动快（~0.2s），用于播放提示音

// 播放提示音：触发即静默兜底（覆盖启动+播放），播放完成后仅留 0.3s 尾声余量立即开放识别
function playTone(wav) {
  muteUntil = Date.now() + 2500;
  try {
    require('child_process').execFile(FFPLAY, ['-nodisp', '-autoexit', wav], { timeout: 8000 }, () => {
      muteUntil = Date.now() + 300;   // 提示音播完 0.3s 后开放识别（用户可马上说话）
    });
  } catch (e) { console.error('[voice-daemon] 播放提示音失败:', String(e)); }
}

const config = {
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: {
      encoder: path.join(MODELS, 'encoder-epoch-99-avg-1.onnx'),
      decoder: path.join(MODELS, 'decoder-epoch-99-avg-1.onnx'),
      joiner: path.join(MODELS, 'joiner-epoch-99-avg-1.onnx'),
    },
    tokens: path.join(MODELS, 'tokens.txt'),
    numThreads: 2,
    provider: 'cpu',
    debug: 0,
  },
  decodingMethod: 'greedy_search',
  maxActivePaths: 4,
  enableEndpoint: true,
  rule1MinTrailingSilence: 4.0,   // 长静音 4 秒判结束
  rule2MinTrailingSilence: 2.5,   // 内容后的静音 2 秒（容忍句内停顿）
  rule3MinUtteranceLength: 30,    // 30 秒强制
};

console.log(`[voice-daemon] ffmpeg: ${FFMPEG}`);
const recognizer = new sherpa.OnlineRecognizer(config);
const stream = recognizer.createStream();
console.log('[voice-daemon] sherpa 模型加载成功，说「你好小智」触发');

const WAKE_RE = /你好小[智志只之知]|小[智志只之知]小[智志只之知]/;
let ff = null;
let state = 'wake';
let lastFull = '';
let lastChange = 0;
let wakeTime = 0;
let lastText = '';
let cmdParts = [];
let lastIncrement = Date.now();

// 提示音静默：提示音触发后 MUTE_MS 内不喂识别帧，杜绝「提示音→自识别」回声
// （方案：提示音触发 1.5s 后开放语音识别）
const MUTE_MS = 1500;
let muteUntil = 0;

function writeCommand(text) {
  const clean = text.replace(WAKE_RE, '').trim();
  if (!clean) return;
  fs.mkdirSync(path.dirname(CMD_FILE), { recursive: true });
  const line = `[${new Date().toLocaleString('sv-SE')}] ${clean}`;
  fs.appendFileSync(CMD_FILE, line + '\n', 'utf8');
  console.log(`[voice-daemon] ✔ 指令: ${clean}`);
}

function beep(times) {
  // Windows Beep 提示音（后台进程也能响）
  const { execFile } = require('child_process');
  const cmd = `[console]::Beep(880,180);` + (times > 1 ? `Start-Sleep -Milliseconds 120; [console]::Beep(880,180);` : '');
  try { execFile('powershell.exe', ['-NoProfile', '-Command', cmd], { timeout: 3000 }); } catch {}
}

function startListening() {
  state = 'wake';
  lastText = '';
  cmdParts = [];
  lastIncrement = Date.now();

  ff = spawn(FFMPEG, [
    '-f', 'dshow', '-i', `audio=${MIC}`,
    '-ar', '16000', '-ac', '1', '-f', 's16le', '-bufsize', '64k', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'ignore'] });

  let buf = Buffer.alloc(0);
  let muted = false;   // 提示音静默中：跳过识别帧
  ff.stdout.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const FRAME = 3200;
    while (buf.length >= FRAME) {
      const pcm = buf.subarray(0, FRAME);
      buf = buf.subarray(FRAME);
      // 提示音触发后 1.5s 内：静默（不喂识别帧），1.5s 后自动恢复
      const isMuted = Date.now() < muteUntil;
      if (isMuted !== muted) {
        muted = isMuted;
        if (isMuted) {
          recognizer.reset(stream);   // 静默开始：丢弃提示音前的识别缓冲
          lastFull = '';
          console.log('[voice-daemon] 提示音静默 1.5s，暂停识别');
        } else {
          console.log('[voice-daemon] 提示音静默结束，恢复识别');
        }
      }
      if (muted) continue;
      const samples = new Float32Array(1600);
      for (let i = 0; i < 1600; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
      stream.acceptWaveform({ samples, sampleRate: 16000 });
      while (recognizer.isReady(stream)) recognizer.decode(stream);
      const full = recognizer.getResult(stream).text || '';
      if (full !== lastFull) { console.log(`[debug] ${state}: "${full}"`); lastFull = full; }

      if (state === 'wake') {
        if (WAKE_RE.test(full)) {
          state = 'command';
          lastFull = full;
          cmdParts = [];
          lastChange = Date.now();
          wakeTime = Date.now();
          console.log('[voice-daemon] 🎙 唤醒，请说指令...');
          // 唤醒人声提示音：「小智已启动，有什么可以帮您」
          playTone(require('path').join(os.homedir(), '.dsh', 'voice-plugin', 'fixed', 'listening.wav'));

        } else if (full.length > lastText.length) {
          lastText = full;
        }
      } else {
        // command：用 sherpa 端点检测判定说完（解码器知道何时真正结束）
        let cmdPart = '';
        const m = full.match(WAKE_RE);
        if (m) {
          cmdPart = full.slice(m.index + m[0].length);
        } else {
          cmdPart = full; // 端点后新 utterance 没有唤醒词，全文即指令
        }
        const now = Date.now();
        if (full !== lastFull) {
          lastFull = full;
          lastChange = now;
        }
        const winOver = now - wakeTime >= 30000;   // 30 秒硬上限
        const validCmd = cmdPart && cmdPart.trim().length >= 2;
        const ep = recognizer.isEndpoint(stream) && now - wakeTime >= 5000;
        if ((ep || winOver) && validCmd) {
          playTone(require('path').join(os.homedir(), '.dsh', 'voice-plugin', 'fixed', 'ack.wav'));
          writeCommand(cmdPart.trim());
          recognizer.reset(stream);
          state = 'wake';
          lastFull = '';

          console.log('[voice-daemon] 待唤醒...');
        }
      }
    }
  });

  ff.on('error', (e) => console.error('[voice-daemon] ffmpeg 错误:', e.message));
  ff.on('close', () => console.error('[voice-daemon] ffmpeg 退出'));
}

process.on('SIGINT', () => { if (ff) ff.kill(); process.exit(0); });
startListening();
console.log('[voice-daemon] 运行中');
setInterval(() => {}, 1 << 30);
