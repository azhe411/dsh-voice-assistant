import fs from 'fs';
import os from 'os';
import path from 'path';
// 语音转录：node stt.mjs <wav路径>
// 用豆包 doubao-seed-2-0-mini（SpeechToText）逐字转述
// key 从 ~/.modlens/config.json 读取（视觉/生图同一把钥匙），也支持环境变量 ARK_API_KEY 覆盖
function getKey() {
  if (process.env.ARK_API_KEY) return process.env.ARK_API_KEY;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.modlens', 'config.json'), 'utf8'));
    if (cfg.providers?.openai?.apiKey) return cfg.providers.openai.apiKey;
  } catch {}
  console.error('未找到 API Key：请配置 ~/.modlens/config.json 或设置环境变量 ARK_API_KEY');
  process.exit(1);
}
const key = getKey();
const wavPath = process.argv[2];
if (!wavPath || !fs.existsSync(wavPath)) { console.error('用法: node stt.mjs <wav路径>'); process.exit(1); }
const audioB64 = fs.readFileSync(wavPath).toString('base64');

const payload = {
  model: 'doubao-seed-2-0-mini-260428',
  messages: [
    { role: 'user', content: [
      { type: 'text', text: '请逐字转述这段语音的内容，原样输出用户说的每个字，不要解释、不要回答、不要添加任何内容。' },
      { type: 'input_audio', input_audio: { data: audioB64, format: 'wav' } }
    ]}
  ]
};

const res = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
const text = await res.text();
if (res.ok) {
  const data = JSON.parse(text);
  console.log(data.choices?.[0]?.message?.content ?? '');
} else {
  console.error('STT 失败:', text.slice(0, 300));
  process.exit(1);
}
