# DSH 语音助手（dsh-voice-assistant）

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 加一个**语音助手**：对电脑说「你好小智」唤醒，然后直接说指令（"帮我查一下明天天气"），DSH 会执行并把结果**朗读给你听**。

- 本地语音识别：sherpa-onnx 流式识别，离线可用，不花钱
- 语音指令执行：说的话自动变成 DSH 会话指令，由 AI 执行
- 语音朗读回复：vits-zh-ll 本地合成，把结果念给你听
- 天气查询：内置天气脚本，说"明天天气"就能听到预报
- 自动开网页：语音触发时自动打开/激活 DSH 界面

> 仅支持 Windows（本机麦克风 + PowerShell 播放）。需要 DSH web 环境。

---

## 目录

1. [原理简介](#原理简介)
2. [系统要求](#系统要求)
3. [安装（3 种方式）](#安装)
4. [首次使用](#首次使用)
5. [日常使用](#日常使用)
6. [自定义配置](#自定义配置)
7. [常见问题排查](#常见问题排查)
8. [项目结构](#项目结构)
9. [隐私与安全](#隐私与安全)

---

## 原理简介

```
你的声音
   │  (麦克风)
   ▼
sherpa-onnx 本地流式识别 (voice-daemon.cjs，常驻后台)
   │  识别出文字
   ▼
写入 ~/.dsh/voice/commands.txt
   │  (每秒轮询)
   ▼
voice-core 插件（DSH 内）发现新指令
   │  创建独立语音会话注入
   ▼
DSH AI 执行指令（查天气/查资料/写东西…）
   │
   ▼
voice-core 监听回复完成
   │
   ▼
vits-zh-ll 本地合成语音 → 播放朗读 (play-wav.ps1)
```

- **识别**：`voice-daemon.cjs` 常驻后台，说「你好小智」唤醒，说完自动判定端点
- **执行**：`voice-core.js` 是 DSH 插件（host 半），轮询命令队列并注入新会话
- **朗读**：插件监听 agent 状态，回复完成后提取文本→TTS→播放

---

## 系统要求

| 项目 | 要求 |
| --- | --- |
| 系统 | Windows 10/11 |
| Node.js | v18+（`node --version` 确认） |
| DSH | 已装好 `dsh web`（3080 端口） |
| 麦克风 | 内置/外接均可 |
| 磁盘 | 约 500MB（模型 + sherpa） |
| 网络 | 安装时需要（下载模型），运行识别/朗读完全离线 |

---

## 安装

### 方式 A：一键安装脚本（推荐）

```bash
git clone https://github.com/<你的用户名>/dsh-voice-assistant.git
cd dsh-voice-assistant
node install.cjs
```

安装脚本自动完成：
1. 创建 `~/.dsh/voice-plugin` 等目录
2. 复制脚本 + 提示音
3. 安装 sherpa-onnx-node（本地识别引擎，约 100MB）
4. 下载中文识别模型（约 300MB，国内 hf-mirror 源）
5. 下载 TTS 朗读模型（vits-zh-ll，约 90MB）
6. 注册 voice-core 插件（固化到 profile）
7. 可选：设置开机自启
8. 启动识别 daemon

> 模型较大，下载需要几分钟，请耐心等待。断网/失败可重跑（已下载的会自动跳过）。

### 方式 B：DSH 插件命令安装

```bash
dsh plugin --profile web add github:<你的用户名>/dsh-voice-assistant
```

但注意：**这种方式只注册插件入口，模型和 sherpa 仍需手动准备**（见下节「手动准备模型」），推荐还是用方式 A。

### 方式 C：手动部署（进阶）

1. 复制 `src/voice-daemon.cjs`、`src/voice-core.js`、`scripts/*`、`assets/sounds/*` 到 `~/.dsh/voice-plugin/`（和 `fixed/` 子目录）
2. 在 `~/.dsh/voice-plugin/` 下执行 `npm install sherpa-onnx-node --no-save`
3. 下载模型到 `~/.dsh/voice-plugin/models/`（见下）
4. 复制 `src/voice-core.js` 到 `~/.dsh/profiles/web/node_modules/@local/voice-core/lib/index.js`，写 package.json
5. 在 `~/.dsh/profiles/web/cordis.patch.yml` 末尾追加：
   ```yaml
   - insert:
       - id: voice-core
         name: '@local/voice-core'
   ```
6. 重启 dsh web

#### 手动准备模型

**识别模型**（放 `~/.dsh/voice-plugin/models/`）：
```bash
# sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23
# 下载并解压，把 encoder-*.onnx / decoder-*.onnx / joiner-*.onnx / tokens.txt 放到 models/ 下
# 源: https://hf-mirror.com/csukuangfj/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23
```

**TTS 模型**（放 `~/.dsh/voice-plugin/tts-models/vits-zh-ll/`）：
```bash
# model.onnx / tokens.txt / lexicon.txt
# 源: https://hf-mirror.com/csukuangfj/sherpa-onnx-vits-zh-ll
```

---

## 首次使用

1. **安装完成后重启 dsh web**（让 voice-core 插件加载）
2. 确认识别 daemon 在跑：
   ```bash
   # 应看到 voice-daemon.cjs 进程
   tasklist | findstr node
   ```
   如果没在跑：`node ~/.dsh/voice-plugin/voice-daemon.cjs`（建议放后台/开机自启）
3. **对着麦克风说：「你好小智」**
   - 听到「小智已启动，有什么可以帮您」→ 唤醒成功
4. **说指令**，比如：
   - 「帮我查一下明天天气」
   - 「今天几号」
   - 「打开记事本」→（AI 会执行/回答）
5. 说完等一两秒，听到「已收到您的指令」，然后 DSH 执行，完成后**语音朗读结果**

> 唤醒词：「你好小智」/「小智小智」（谐音容错：志/只/之/知 都能触发）

---

## 日常使用

### 语音指令示例

| 你说 | DSH 会 |
| --- | --- |
| 「明天天气怎么样」 | 运行天气脚本 → 播报明天预报 |
| 「帮我写一段自我介绍」 | AI 生成 → 朗读 |
| 「今天星期几」 | 回答 → 朗读 |
| 「搜一下 XX」 | 联网搜索 → 总结朗读 |
| 任何想做的事 | 转成指令执行 → 朗读结果 |

### 关键提示音

| 提示音 | 含义 |
| --- | --- |
| 「小智已启动，有什么可以帮您」 | 唤醒成功，可以说指令 |
| 「已收到您的指令」 | 指令已提交给 DSH |
| （朗读内容） | 执行结果 |

### 手动启动/停止

```bash
# 启动识别 daemon（后台）
start /b node ~/.dsh/voice-plugin/voice-daemon.cjs

# 停止（杀掉 daemon 进程）
taskkill /f /im node.exe  # 谨慎：会杀掉所有 node，仅当你知道自己在做什么
```

### 开机自启

安装时选择 y 会自动设置；手动设置：
- 把 `voice-daemon.vbs` 放到 `启动` 文件夹（`Win+R` → `shell:startup`）
- vbs 内容：`Set sh = CreateObject("WScript.Shell") : sh.Run "node <daemon路径>", 0, False`

---

## 自定义配置

### 唤醒词

编辑 `~/.dsh/voice-plugin/voice-daemon.cjs`，找到 `WAKE_RE` 正则，修改匹配词。

### 语音指令提示词

编辑 `~/.dsh/profiles/web/node_modules/@local/voice-core/lib/index.js`，找到「语音指令规则」那段文字（注入给模型的提示词），可自定义。

### 播报长度

`index.js` 里 `speakText` 前的 `.slice(0, 80)` 控制朗读字数上限。

### 麦克风选择

`voice-daemon.cjs` 里 `device` 参数可指定设备名（中文设备名可能需用 ASCII 替代名，见排查）。

### 数字转中文

`digitsToCn()` 函数处理阿拉伯数字→中文读音（TTS 不认阿拉伯数字）。符号映射：`℃→摄氏度`、`km/h→公里每小时`。

---

## 常见问题排查

| 症状 | 原因与解决 |
| --- | --- |
| 唤醒没反应 | daemon 没跑：`node ~/.dsh/voice-plugin/voice-daemon.cjs` 手动启动看报错 |
| daemon 报麦克风错误 | 设备名不对：改 `device` 参数；或 System.Speech 与 sherpa 抢麦克风（关掉 voice-boot 待机） |
| 识别到了但 DSH 没执行 | voice-core 插件没加载：检查 patch 里有没有 `voice-core`，重启 dsh |
| 不朗读 | 回复没有【语音播报】标记会读整条；检查 TTS 模型是否下载完整（model.onnx 等三个文件） |
| 播放没声音 | 用 `play-wav.ps1`（MCI）播放，别用 ffplay；检查系统音量 |
| 中文设备名乱码 | 用 ASCII 替代名（`Get-PnpDevice` 查实际设备名） |
| 提示音把自己也识别进去 | 回声过滤：daemon 播放提示音后 1.5s 内跳过识别帧（已内置） |
| vbs 开机自启不工作 | wscript 不支持 UTF-8 编码的 .vbs，必须纯 ASCII 保存 |
| 天气查询没反应 | 手动跑 `node ~/.dsh/voice-plugin/weather.cjs 1` 看输出；城市由 IP 自动定位 |

---

## 项目结构

```
dsh-voice-assistant/
├── install.cjs             # 一键安装脚本（推荐）
├── cordis.patch.yml        # bundle 插件注册（方式 B 用）
├── package.json            # 插件包定义
├── src/
│   ├── voice-core.js       # DSH 插件本体（指令注入 + 朗读）★核心
│   └── voice-daemon.cjs    # 本地识别 daemon（sherpa 流式）★核心
├── scripts/
│   ├── play-wav.ps1        # WAV 播放（MCI，稳定快速）
│   ├── voice-boot.ps1      # 开机兜底（System.Speech 唤醒启动 dsh）
│   ├── weather.cjs         # 天气查询（IP 定位 + 中国天气网）
│   ├── speak.cjs           # 单次 TTS 合成+播放（测试用）
│   ├── stt.mjs             # 豆包在线转录（备用，读 ~/.modlens 的 key）
│   └── gen-fixed.cjs       # 生成提示音（可重新生成）
└── assets/sounds/          # 提示音（唤醒/收到/成功/失败/进行中）
```

---

## 隐私与安全

- 识别和朗读全在本地，声音不上传，sherpa 和 vits 都是本地模型
- 没有硬编码密钥。唯一的在线能力（天气、可选豆包 STT）用的 key 从 `~/.modlens/config.json` 读取，不写死在代码里
- 天气查询只请求中国天气网公开接口（IP 定位城市）
- 语音指令会被执行：你说的话会被 DSH 的 AI 执行（能操作电脑），请只在你信任的环境使用

---

## License

MIT
