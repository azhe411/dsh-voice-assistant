// gen-fixed.cjs - 预合成固定问好音频（只生成不播放）
const path = require('path');
const os = require('os');
const fs = require('fs');
const sherpa = require(path.join(os.homedir(), '.dsh', 'voice-plugin', 'node_modules', 'sherpa-onnx-node'));

const DIR = path.join(os.homedir(), '.dsh', 'voice-plugin', 'tts-models', 'vits-zh-ll');
const OUT = path.join(os.homedir(), '.dsh', 'voice-plugin', 'fixed');
fs.mkdirSync(OUT, { recursive: true });

const tts = new sherpa.OfflineTts({
  model: { vits: { model: path.join(DIR, 'model.onnx'), tokens: path.join(DIR, 'tokens.txt'), lexicon: path.join(DIR, 'lexicon.txt') } },
  numThreads: 2, provider: 'cpu',
});

const phrases = {
  'boot-greeting.wav': '你好，小智已启动，有什么可以帮你？',
  'running.wav': '小智已经在运行了，有什么可以帮你？',
  'fail.wav': '小智启动失败，请检查日志',
  'listening.wav': '好的，请说指令',
  'ack.wav': '已收到您的指令',
};

for (const [file, text] of Object.entries(phrases)) {
  const audio = tts.generate({ text, sid: 0, speed: 1.1 });
  const wav = path.join(OUT, file);
  sherpa.writeWave(wav, { samples: audio.samples, sampleRate: audio.sampleRate });
  console.log(`✓ ${file} (${(audio.samples.length / 16000).toFixed(1)}s, ${Math.round(fs.statSync(wav).size / 1024)}KB)`);
}
console.log('完成');
