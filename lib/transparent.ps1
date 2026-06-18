# ============================================================
# ZCode 窗口透明模式 —— 用 Win32 SetLayeredWindowAttributes 让
# ZCode 主窗口半透明，能透过窗口看桌面。
# ------------------------------------------------------------
# 这是独立子系统：不走 CDP (透明是窗口层的事，见 spec §6)。
# 常驻监听热键调透明度：
#   Ctrl+Alt+Up   变不透明 (+Step)
#   Ctrl+Alt+Down 变透明     (-Step)
#   Ctrl+Alt+0    恢复完全不透明 + 退出
#
# 窗口选择规则必须和 lib/windowselect.cjs 的 selectMainWindow 一致
# (spec §5.3/§8.1)：pid 过滤 + visible + toplevel + 零面积过滤；
# 单候选自动选，多候选 read-host 让用户选。
#
# 用法 (必须 -File 跑，见 AGENTS.md 环境注意)：
#   powershell -NoProfile -ExecutionPolicy Bypass -File lib/transparent.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File lib/transparent.ps1 -ProcessName ZCode -InitialAlpha 180
# ============================================================

param(
  [string]$ProcessName  = "ZCode",
  [int]   $InitialAlpha = 200,   # 0-255, 默认 ~78% (偏不透明保可读)
  [int]   $Step         = 25,
  [int]   $MinAlpha     = 30,    # 防止调到完全看不见
  [int]   $MaxAlpha     = 255
)

# Win32 P/Invoke。常量命名清楚，不在 C# 里裸写 magic number。
$win32Code = @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern int  GetWindowLong(IntPtr h, int nIndex);
  [DllImport("user32.dll")] public static extern int  SetWindowLong(IntPtr h, int nIndex, int dwNewLong);
  [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
  [StructLayout(LayoutKind.Sequential)]
  public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int pt_x; public int pt_y; }
  [DllImport("user32.dll")] public static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
}
"@
Add-Type -TypeDefinition $win32Code -Language CSharp

# Win32 常量
$GWL_EXSTYLE     = -20
$WS_EX_LAYERED   = 0x00080000
$LWA_ALPHA       = 0x00000002
$MOD_CONTROL     = 0x0002
$MOD_ALT         = 0x0001
$VK_UP           = 0x26
$VK_DOWN         = 0x28
$VK_0            = 0x30
$WM_HOTKEY       = 0x0312
$HOTKEY_UP       = 1
$HOTKEY_DOWN     = 2
$HOTKEY_ZERO     = 3

# ---- 1) 找目标进程的 PID 集合 ----
$procs = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
if (-not $procs -or @($procs).Count -eq 0) {
  Write-Host "[transparent] 没找到进程 '$ProcessName'。" -ForegroundColor Yellow
  Write-Host "[transparent] 用 Get-Process 看真实进程名 (Electron 应用可能叫别的)，"
  Write-Host "[transparent] 然后: powershell -File transparent.ps1 -ProcessName <真实名>"
  exit 1
}
$pidSet = @($procs).Id

# ---- 2) 枚举顶层窗口，过滤候选 ----
# EnumWindows + IsWindowVisible 拿可见顶层窗口，GetWindow(GW_OWNER) 过掉子窗口。
$enumCode = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinEnum {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<string> Dump(IntPtr[] pidFilter) {
    var pids = new HashSet<uint>();
    foreach (var p in pidFilter) pids.Add((uint)p);
    var lines = new List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid)) return true;
      RECT r; GetWindowRect(h, out r);
      var title = new StringBuilder(256); GetWindowText(h, title, 256);
      var cls   = new StringBuilder(256); GetClassName(h, cls, 256);
      // GW_OWNER = 4
      var owner = GetWindow(h, 4);
      lines.Add(h.ToInt64() + "|" + pid + "|" + cls + "|" + title + "|"
                + (r.Right - r.Left) + "x" + (r.Bottom - r.Top) + "|" + (owner == IntPtr.Zero ? "1" : "0"));
      return true;
    }, IntPtr.Zero);
    return lines;
  }
}
"@
Add-Type -TypeDefinition $enumCode -Language CSharp

$pidPtr = @($pidSet | ForEach-Object { [IntPtr]$_ })
$raw = [WinEnum]::Dump($pidPtr)
# 解析成对象数组 (对齐 windowselect.cjs 的 shape)
$windows = foreach ($line in $raw) {
  $p = $line -split '\|'
  $size = $p[5] -split 'x'
  [pscustomobject]@{
    hwnd      = [long]$p[0]
    pid       = [int]$p[1]
    className = $p[2]
    title     = $p[3]
    width     = [int]$size[0]
    height    = [int]$size[1]
    visible   = $true       # EnumWindows+IsWindowVisible 已过滤
    toplevel  = ($p[6] -eq "1")
  }
}
# 应用 windowselect.cjs 同款规则：pid (已过滤) + visible (已) + toplevel + 面积>0
$candidates = @($windows | Where-Object { $_.toplevel -and $_.width -gt 0 -and $_.height -gt 0 })

if ($candidates.Count -eq 0) {
  Write-Host "[transparent] 进程 '$ProcessName' 在跑，但没找到可见顶层窗口。" -ForegroundColor Yellow
  exit 2
}

# 选择 (对齐 windowselect.cjs：单候选自动选，多候选 read-host)
if ($candidates.Count -eq 1) {
  $chosen = $candidates[0]
  Write-Host "[transparent] 唯一候选窗口: '$($chosen.title)' ($($chosen.width)x$($chosen.height))"
} else {
  # 多候选：按面积降序列出，让用户选 (对齐 windowselect.cjs 的 ambiguous 分支)
  $sorted = @($candidates | Sort-Object { $_.width * $_.height } -Descending)
  Write-Host "[transparent] 找到 $($sorted.Count) 个候选窗口，请选主窗口："
  for ($i = 0; $i -lt $sorted.Count; $i++) {
    $w = $sorted[$i]
    Write-Host ("  [{0}] '{1}'  {2}x{3}  (class={4})" -f $i, $w.title, $w.width, $w.height, $w.className)
  }
  $sel = Read-Host "输入序号 (0-$($sorted.Count - 1))"
  $idx = 0; if (-not [int]::TryParse($sel, [ref]$idx) -or $idx -lt 0 -or $idx -ge $sorted.Count) {
    Write-Host "[transparent] 无效序号，退出。" -ForegroundColor Yellow
    exit 3
  }
  $chosen = $sorted[$idx]
  Write-Host "[transparent] 已选: '$($chosen.title)'"
}
$hwnd = [IntPtr]$chosen.hwnd

# ---- 3) 设透明 ----
function Set-Alpha($h, $a) {
  $style = [Win32]::GetWindowLong($h, $GWL_EXSTYLE)
  [Win32]::SetWindowLong($h, $GWL_EXSTYLE, $style -bor $WS_EX_LAYERED) | Out-Null
  [Win32]::SetLayeredWindowAttributes($h, 0, $a, $LWA_ALPHA) | Out-Null
}

$script:alpha = $InitialAlpha
Set-Alpha $hwnd $script:alpha
Write-Host "[transparent] 已设透明 alpha=$script:alpha/255"

# ---- 4) 注册热键 ----
$okUp   = [Win32]::RegisterHotKey([IntPtr]::Zero, $HOTKEY_UP,   $MOD_CONTROL -bor $MOD_ALT, $VK_UP)
$okDown = [Win32]::RegisterHotKey([IntPtr]::Zero, $HOTKEY_DOWN, $MOD_CONTROL -bor $MOD_ALT, $VK_DOWN)
$okZero = [Win32]::RegisterHotKey([IntPtr]::Zero, $HOTKEY_ZERO, $MOD_CONTROL -bor $MOD_ALT, $VK_0)
if (-not $okUp -or -not $okDown -or -not $okZero) {
  Write-Warning "部分热键注册失败 (Up=$okUp Down=$okDown Zero=$okZero)，可能和其他软件冲突。"
}
Write-Host "[transparent] 热键: Ctrl+Alt+Up=变不透明  Ctrl+Alt+Down=变透明  Ctrl+Alt+0=恢复并退出"

# ---- 5) 消息循环 ----
$exitLoop = $false
try {
  while (-not $exitLoop) {
    $msg = New-Object Win32+MSG
    $ret = [Win32]::GetMessage([ref]$msg, [IntPtr]::Zero, 0, 0)
    if ($ret -le 0) { break }   # WM_QUIT 或出错
    if ($msg.message -eq $WM_HOTKEY) {
      switch ([int]$msg.wParam) {
        $HOTKEY_UP {
          $script:alpha = [Math]::Min($MaxAlpha, $script:alpha + $Step)
          Set-Alpha $hwnd $script:alpha
          Write-Host "[transparent] alpha = $script:alpha / 255"
        }
        $HOTKEY_DOWN {
          $script:alpha = [Math]::Max($MinAlpha, $script:alpha - $Step)
          Set-Alpha $hwnd $script:alpha
          Write-Host "[transparent] alpha = $script:alpha / 255"
        }
        $HOTKEY_ZERO {
          Write-Host "[transparent] 恢复不透明并退出..."
          $exitLoop = $true
        }
      }
    }
  }
}
finally {
  # 退出清理：即使 Ctrl+C 也恢复 (PS 的 finally 在 trap/Ctrl+C 下会执行)
  [Win32]::UnregisterHotKey([IntPtr]::Zero, $HOTKEY_UP)   | Out-Null
  [Win32]::UnregisterHotKey([IntPtr]::Zero, $HOTKEY_DOWN) | Out-Null
  [Win32]::UnregisterHotKey([IntPtr]::Zero, $HOTKEY_ZERO) | Out-Null
  Set-Alpha $hwnd 255
  $style = [Win32]::GetWindowLong($hwnd, $GWL_EXSTYLE)
  [Win32]::SetWindowLong($hwnd, $GWL_EXSTYLE, $style -band (-bnot $WS_EX_LAYERED)) | Out-Null
  Write-Host "[transparent] 已恢复不透明并退出。"
}
