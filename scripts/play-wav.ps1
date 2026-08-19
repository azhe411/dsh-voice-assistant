param([string]$Wav)
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class MCI {
  [DllImport("winmm.dll")]
  public static extern int mciSendString(string cmd, string buf, int len, int h);
}
"@
[MCI]::mciSendString("open `"$Wav`" alias w", "", 0, 0) | Out-Null
[MCI]::mciSendString("play w wait", "", 0, 0) | Out-Null
[MCI]::mciSendString("close w", "", 0, 0) | Out-Null
