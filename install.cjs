// install.cjs — DSH 语音助手一键安装（Windows）
// 用法: node install.cjs
// 功能: 安装 sherpa-onnx → 下载 ASR/TTS 模型 → 复制脚本到 ~/.dsh/voice-plugin → 注册 voice-core 插件 → 启动 daemon
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const HOME = os.homedir();
const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh');
const VOICE_DIR = path.join(DSH_HOME, 'voice');            // 数据/命令队列
const PLUGIN_DIR = path.join(DSH_HOME, 'voice-plugin');     // 脚本+模型+node_modules
const PROFILE_DIR = path.join(DSH_HOME, 'profiles', 'web');
const PATCH_FILE = path.join(PROFILE_DIR, 'cordis.patch.yml');
const SRC = __dirname;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

function log(ok, msg) { console.log((ok ? '✅ ' : '⚠️ ') + msg); }
function mkdir(p) { fs.mkdirSync(p, { recursive: true }); }
function has(p) { return fs.existsSync(p); }

// 下载工具（跟随重定向 + 进度条）
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(new URL(res.headers.location, url).href, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let done = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (c) => { done += c.length; if (total) process.stdout.write('\r  下载中 ' + (done / 1048576).toFixed(1) + '/' + (total / 1048576).toFixed(1) + ' MB'); });
      res.pipe(out);
      out.on('finish', () => { process.stdout.write('\n'); out.close(); resolve(); });
      out.on('error', reject);
    });
    req.on('error', reject);
  });
}

// 解压 tar.bz2（用系统 tar，Windows 10+ 自带）
function extractTarBz2(file, destDir) {
  mkdir(destDir);
  const r = execSync(`tar -xjf "${file}" -C "${destDir}"`, { stdio: 'ignore' });
  return r;
}

async function main() {
  console.log('\n🎤 DSH 语音助手一键安装\n');

  // 0) 环境检查
  try { execSync('node --version', { stdio: 'ignore' }); } catch { console.error('❌ 需要 Node.js'); process.exit(1); }

  // 1) 建目录
  console.log('\n── 第 1 步：创建目录 ──');
  mkdir(VOICE_DIR);
  mkdir(path.join(PLUGIN_DIR, 'models'));
  mkdir(path.join(PLUGIN_DIR, 'tts-models'));
  mkdir(path.join(PLUGIN_DIR, 'fixed'));
  mkdir(path.join(PLUGIN_DIR, 'node_modules'));
  log(true, '目录已创建');

  // 2) 复制脚本 + 提示音
  console.log('\n── 第 2 步：复制脚本与提示音 ──');
  const copyList = [
    ['src/voice-daemon.cjs', path.join(PLUGIN_DIR, 'voice-daemon.cjs')],
    ['src/voice-core.js', path.join(PLUGIN_DIR, 'voice-core.cjs')],
    ['scripts/play-wav.ps1', path.join(PLUGIN_DIR, 'play-wav.ps1')],
    ['scripts/voice-boot.ps1', path.join(PLUGIN_DIR, 'voice-boot.ps1')],
    ['scripts/weather.cjs', path.join(PLUGIN_DIR, 'weather.cjs')],
    ['scripts/speak.cjs', path.join(PLUGIN_DIR, 'speak.cjs')],
    ['scripts/stt.mjs', path.join(PLUGIN_DIR, 'stt.mjs')],
  ];
  for (const [src, dst] of copyList) {
    fs.copyFileSync(path.join(SRC, src), dst);
    log(true, '复制 ' + path.basename(src));
  }
  // 提示音
  for (const f of fs.readdirSync(path.join(SRC, 'assets', 'sounds'))) {
    if (f.endsWith('.wav')) fs.copyFileSync(path.join(SRC, 'assets', 'sounds', f), path.join(PLUGIN_DIR, 'fixed', f));
  }
  log(true, '提示音已复制');

  // 3) 安装 sherpa-onnx-node
  console.log('\n── 第 3 步：安装 sherpa-onnx（本地语音识别引擎）──');
  if (has(path.join(PLUGIN_DIR, 'node_modules', 'sherpa-onnx-node'))) {
    log(true, 'sherpa 已安装，跳过');
  } else {
    log(false, '正在安装（约 100MB，耐心等待）…');
    try {
      execSync(`npm install --prefix "${PLUGIN_DIR}" sherpa-onnx-node --no-save`, { stdio: 'inherit', timeout: 600000 });
      log(true, 'sherpa 安装完成');
    } catch {
      log(false, 'npm 安装失败，尝试国内镜像…');
      execSync(`npm install --prefix "${PLUGIN_DIR}" sherpa-onnx-node --no-save --registry=https://registry.npmmirror.com`, { stdio: 'inherit', timeout: 600000 });
      log(true, 'sherpa 安装完成（镜像）');
    }
  }

  // 4) 下载 ASR 模型（中文流式识别）
  console.log('\n── 第 4 步：下载语音识别模型（约 300MB）──');
  const asrTar = path.join(PLUGIN_DIR, 'models', 'asr-model.tar.bz2');
  if (!has(path.join(PLUGIN_DIR, 'models', 'encoder-epoch-99-avg-1.onnx'))) {
    log(false, '下载中（hf-mirror，国内快）…');
    try {
      await download('https://hf-mirror.com/csukuangfj/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23/resolve/main/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23.tar.bz2', asrTar);
      extractTarBz2(asrTar, path.join(PLUGIN_DIR, 'models'));
      // 把解压出的子目录内容上移
      const sub = fs.readdirSync(path.join(PLUGIN_DIR, 'models')).filter((n) => n.startsWith('sherpa-onnx-streaming'));
      if (sub.length) {
        const subDir = path.join(PLUGIN_DIR, 'models', sub[0]);
        for (const f of fs.readdirSync(subDir)) fs.copyFileSync(path.join(subDir, f), path.join(PLUGIN_DIR, 'models', f));
        fs.rmSync(subDir, { recursive: true, force: true });
      }
      fs.rmSync(asrTar, { force: true });
      log(true, '识别模型下载完成');
    } catch (e) {
      log(false, '识别模型下载失败: ' + e.message + '（可手动下载后放入 ~/.dsh/voice-plugin/models/）');
    }
  } else {
    log(true, '识别模型已存在，跳过');
  }

  // 5) TTS 模型（本地朗读）
  console.log('\n── 第 5 步：下载语音合成模型（vits-zh-ll）──');
  const ttsDir = path.join(PLUGIN_DIR, 'tts-models', 'vits-zh-ll');
  if (!has(path.join(ttsDir, 'model.onnx'))) {
    mkdir(ttsDir);
    log(false, '下载中（vits-zh-ll，约 90MB）…');
    try {
      await download('https://hf-mirror.com/csukuangfj/sherpa-onnx-vits-zh-ll/resolve/main/model.onnx', path.join(ttsDir, 'model.onnx'));
      await download('https://hf-mirror.com/csukuangfj/sherpa-onnx-vits-zh-ll/resolve/main/tokens.txt', path.join(ttsDir, 'tokens.txt'));
      await download('https://hf-mirror.com/csukuangfj/sherpa-onnx-vits-zh-ll/resolve/main/lexicon.txt', path.join(ttsDir, 'lexicon.txt'));
      log(true, 'TTS 模型下载完成');
    } catch (e) {
      log(false, 'TTS 模型下载失败: ' + e.message + '（可手动下载放入 ~/.dsh/voice-plugin/tts-models/vits-zh-ll/）');
    }
  } else {
    log(true, 'TTS 模型已存在，跳过');
  }

  // 6) 注册 voice-core 插件（固化）
  console.log('\n── 第 6 步：注册 voice-core 插件 ──');
  const vcDir = path.join(PROFILE_DIR, 'node_modules', '@local', 'voice-core');
  mkdir(path.join(vcDir, 'lib'));
  fs.copyFileSync(path.join(SRC, 'src', 'voice-core.js'), path.join(vcDir, 'lib', 'index.js'));
  fs.writeFileSync(path.join(vcDir, 'package.json'), JSON.stringify({
    name: '@local/voice-core', version: '1.0.0', type: 'module', main: 'lib/index.js'
  }, null, 2));
  if (has(PATCH_FILE) && fs.readFileSync(PATCH_FILE, 'utf8').includes('id: voice-core')) {
    log(true, 'patch 已有 voice-core，跳过');
  } else {
    fs.appendFileSync(PATCH_FILE, '\n# voice-assistant: voice-core\n- insert:\n    - id: voice-core\n      name: \'@local/voice-core\'\n');
    log(true, 'voice-core 已注册到 patch');
  }

  // 7) 自启（可选）
  console.log('\n── 第 7 步：设置开机自启（可选）──');
  const ans = (await ask('要设置开机自动启动语音助手吗？(y/n，默认 n): ')).trim().toLowerCase();
  if (ans === 'y') {
    const startup = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    const vbs = path.join(startup, 'voice-daemon.vbs');
    const daemonPath = path.join(PLUGIN_DIR, 'voice-daemon.cjs');
    fs.writeFileSync(vbs, 'Set sh = CreateObject("WScript.Shell")\nsh.Run "node "' + ' ' + '"' + daemonPath + '"' + ', 0, False\n');
    log(true, '开机自启已设置');
  }

  // 8) 启动 daemon
  console.log('\n── 第 8 步：启动语音识别 daemon ──');
  const daemon = spawn(process.execPath, [path.join(PLUGIN_DIR, 'voice-daemon.cjs')], { detached: true, stdio: 'ignore' });
  daemon.unref();
  log(true, 'daemon 已启动（说「你好小智」试试！）');

  console.log('\n🎉 安装完成！');
  console.log('  1. 重启 dsh web（让它加载 voice-core 插件）');
  console.log('  2. 打开 http://127.0.0.1:3080');
  console.log('  3. 说「你好小智」→ 听到提示音后说指令 → dsh 执行并语音播报');
  console.log('  4. 指令带天气查询：说「明天天气怎么样」');
  console.log('\n📖 详细使用教程见 README.md\n');
  rl.close();
}

main().catch((e) => { console.error('❌ 出错:', e.message); rl.close(); process.exit(1); });
