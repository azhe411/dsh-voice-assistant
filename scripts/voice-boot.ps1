# voice-boot.ps1 - 语音开机监听器（不依赖 dsh，开机自启）
# 说「你好小智」→ 若 dsh 未运行则启动它 → 语音问好
Add-Type -AssemblyName System.Speech

$HOME_DIR = $env:USERPROFILE
$CULTURE = [System.Globalization.CultureInfo]::GetCultureInfo("zh-CN")
$NODE = "C:\Program Files\nodejs\node.exe"
$DSH_BIN = (Get-ChildItem "$HOME_DIR\AppData\Local\npm-cache\_npx\*\node_modules\@deepseek-ai\dsh\lib\bin.js" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
$SPEAK = Join-Path $HOME_DIR ".dsh\voice-plugin\speak.cjs"
$LOG_OUT = Join-Path $HOME_DIR ".dsh\voice\boot.out.log"
$LOG_ERR = Join-Path $HOME_DIR ".dsh\voice\boot.err.log"

if (-not $DSH_BIN) { Write-Host "找不到 dsh bin.js"; exit 1 }
Write-Host "voice-boot 监听中：说「你好小智」启动 dsh" -ForegroundColor Cyan

$FIXED = Join-Path $HOME_DIR ".dsh\voice-plugin\fixed"

$PLAY_WAV = Join-Path $HOME_DIR ".dsh\voice-plugin\play-wav.ps1"
function SayAudio($name) {
  $wav = Join-Path $FIXED $name
  if (Test-Path $wav) {
    try { & powershell -NoProfile -ExecutionPolicy Bypass -File $PLAY_WAV $wav | Out-Null } catch {}
  }
}

function DshRunning {
  return [bool](Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue)
}

while ($true) {
  # dsh 运行中：sherpa 负责监听，voice-boot 完全待机（不抢麦克风、不播报）
  if (DshRunning) {
    Start-Sleep -Seconds 15
    continue
  }
  try {
    $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine($CULTURE)
    $choices = New-Object System.Speech.Recognition.Choices
    $choices.Add("你好小智")
    $choices.Add("小智小智")
    $builder = New-Object System.Speech.Recognition.GrammarBuilder
    $builder.Culture = $CULTURE
    $builder.Append($choices)
    $rec.LoadGrammar((New-Object System.Speech.Recognition.Grammar($builder)))
    $rec.SetInputToDefaultAudioDevice()
    $r = $rec.Recognize([TimeSpan]::FromMinutes(30))
    $rec.Dispose()
    if (-not $r) { continue }
    Write-Host "[$(Get-Date -Format HH:mm:ss)] 唤醒: $($r.Text)" -ForegroundColor Green

    if (DshRunning) {
      SayAudio "running.wav"
      continue
    }

    # 启动 dsh（后台，日志重定向）
    Write-Host "启动 dsh..." -ForegroundColor Yellow
    Start-Process -FilePath $NODE -ArgumentList $DSH_BIN, "web" -WorkingDirectory $HOME_DIR -WindowStyle Hidden -RedirectStandardOutput $LOG_OUT -RedirectStandardError $LOG_ERR

    # 等待 dsh 就绪（最多 40 秒）
    $ready = $false
    for ($i = 0; $i -lt 20; $i++) {
      Start-Sleep -Seconds 2
      if (DshRunning) { $ready = $true; break }
    }
    if ($ready) {
      Start-Process "http://127.0.0.1:3080"   # 自动打开浏览器界面
      Start-Sleep -Seconds 3
      SayAudio "boot-greeting.wav"
      Write-Host "dsh 已启动并打开界面" -ForegroundColor Green
    } else {
      SayAudio "fail.wav"
      Write-Host "dsh 启动失败" -ForegroundColor Red
    }
  } catch {
    Write-Host "错误: $($_.Exception.Message)" -ForegroundColor Red
    Start-Sleep -Seconds 2
  }
}