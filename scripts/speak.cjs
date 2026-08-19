// speak.cjs - sherpa TTS 合成并播放（vits-zh-ll 音色 1.1 倍速）
// 用法: node speak.cjs "要朗读的文本"
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const sherpa = require(path.join(os.homedir(), '.dsh', 'voice-plugin', 'node_modules', 'sherpa-onnx-node'));

const DIR = path.join(os.homedir(), '.dsh', 'voice-plugin', 'tts-models', 'vits-zh-ll');
const text = process.argv[2] || '';
if (!text.trim()) { console.error('用法: node speak.cjs "文本"'); process.exit(1); }

const tts = new sherpa.OfflineTts({
  model: { vits: { model: path.join(DIR, 'model.onnx'), tokens: path.join(DIR, 'tokens.txt'), lexicon: path.join(DIR, 'lexicon.txt') } },
  numThreads: 2, provider: 'cpu',
});
const audio = tts.generate({ text, sid: 0, speed: 1.1 });
const wav = path.join(os.tmpdir(), 'speak-tmp.wav');
sherpa.writeWave(wav, { samples: audio.samples, sampleRate: audio.sampleRate });

// ffplay 播放
const ffplay = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-9.0-full_build', 'bin', 'ffplay.exe');
try {
  execSync(`"${ffplay}" -nodisp -autoexit "${wav}"`, { stdio: 'ignore' });
} catch {}
try { require('fs').unlinkSync(wav); } catch {}
process.exit(0);
