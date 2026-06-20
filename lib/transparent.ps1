# ============================================================
# ZCode 窗口透明模式 —— 用 Win32 SetLayeredWindowAttributes 把
# ZCode 主窗口设成指定透明度，设完即退 (不阻塞、不监听热键)。
# ------------------------------------------------------------
# 这是独立子系统：不走 CDP (透明是窗口层的事，见 spec §6)。
# 用法 (必须 -File 跑，见 AGENTS.md 环境注意)：
#   powershell -NoProfile -ExecutionPolicy Bypass -File lib/transparent.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File lib/transparent.ps1 -Opacity 50
#   powershell -NoProfile -ExecutionPolicy Bypass -File lib/transparent.ps1 -Opacity 0   # 完全透明 (慎用)
#   powershell -NoProfile -ExecutionPolicy Bypass -File lib/transparent.ps1 -Opacity 100  # 恢复不透明
#
# 透明度语义 (-Opacity, 直觉百分比)：
#   100 = 完全不透明 (恢复原样)
#   50  = 半透明 (能透出桌面，字也半淡)
#   0   = 完全透明 (窗口看不见，慎用)
#   alpha 是整个窗口均匀半透明——代码字、菜单、背景一起按同一比例变淡。
#   这是 Win32 LWA_ALPHA 的硬约束 (见 AGENTS.md 核心教训 2 的同型坑)。
#
# 窗口选择规则必须和 lib/windowselect.cjs 的 selectMainWindow 一致
# (spec §5.3/§8.1)：pid 过滤 + visible + toplevel + 零面积过滤；
# 单候选自动选，多候选 read-host 让用户选。
#
# 历史版本曾有 Ctrl+Alt 热键循环，已按用户要求移除 (设完就完，不再微调)。
# 要恢复透明度：再跑 -Opacity 100。
# ============================================================

param(
  [string]$ProcessName = "ZCode",
  [int]   $Opacity      = 78,    # 0-100，默认 78 (偏不透明保可读)，对齐旧 InitialAlpha=200
  [int]   $InitialAlpha = -1,    # 兼容旧用法 (0-255)；设了就以它为准，忽略 -Opacity
  [switch]$Query,                # 只读查询模式 (spec §4 A3 改动2)：查当前 alpha，绝不 Set
  [long]  $Hwnd         = 0,     # -Query 时直接按 hwnd 查 (0=走窗口枚举选面积最大)
  [switch]$Json                 # 机器可读输出 (查询/设置都支持，spec §4 A3 改动3)
)

# Win32 P/Invoke。常量命名清楚，不在 C# 里裸写 magic number。
$win32Code = @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern int  GetWindowLong(IntPtr h, int nIndex);
  [DllImport("user32.dll")] public static extern int  SetWindowLong(IntPtr h, int nIndex, int dwNewLong);
  [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);
  [DllImport("user32.dll")] public static extern bool GetLayeredWindowAttributes(IntPtr hwnd, out uint crKey, out byte bAlpha, out uint dwFlags);
}
"@
Add-Type -TypeDefinition $win32Code -Language CSharp

# Win32 常量
$GWL_EXSTYLE   = -20
$WS_EX_LAYERED = 0x00080000
$LWA_ALPHA     = 0x00000002

# ---- 解析目标 alpha (0-255) ----
# -InitialAlpha 优先 (0-255，旧用法)；否则 -Opacity (0-100，新用法) 换算。
if ($InitialAlpha -ge 0) {
  $alpha = [Math]::Max(0, [Math]::Min(255, $InitialAlpha))
} else {
  $opacity = [Math]::Max(0, [Math]::Min(100, $Opacity))
  $alpha = [int][Math]::Round($opacity * 2.55)
}
Write-Host "[transparent] 目标透明度: Opacity=$Opacity% -> alpha=$alpha/255"

# ---- WinEnum (窗口枚举) 提前 Add-Type，供下方 -Query 分支和 set 流程共用 ----
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

# ---- 0) -Query 模式：只读查询 alpha，绝不 Set (spec §4 A3 改动2) ----
if ($Query) {
  function Get-Alpha-Info([IntPtr]$h) {
    # 返回 @{ layered=bool; alpha=int }。GetLayeredWindowAttributes 拿不到(layered 未设)时 layered=false。
    $key = [uint32]0; $a = [byte]0; $flags = [uint32]0
    $ok = [Win32]::GetLayeredWindowAttributes($h, [ref]$key, [ref]$a, [ref]$flags)
    # LWA_ALPHA=0x2：flags 含它说明 alpha 生效
    $layered = (($flags -band $LWA_ALPHA) -ne 0)
    return @{ layered = $layered; alpha = [int]$a }
  }
  if ($Hwnd -gt 0) {
    # 直接按 hwnd 查 (server 记的 hwnd，快且回避多候选)
    $h = [IntPtr]$Hwnd
    $r = Get-Alpha-Info $h
    $obj = @{ hwnd = $Hwnd; alpha = $(if ($r.layered) { $r.alpha } else { $null });
              opacityPct = $(if ($r.layered) { [Math]::Round($r.alpha / 255 * 100) } else { $null });
              layered = $r.layered }
    if ($Json) { Write-Output ($obj | ConvertTo-Json -Compress) }
    else { Write-Host ("hwnd=" + $Hwnd + " layered=" + $r.layered + " alpha=" + $r.alpha) }
    exit 0
  }
  # 没给 hwnd：枚举进程窗口，多候选自动选面积最大 (不 read-host，spec §10 状态机"否"分支)
  $qprocs = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
  if (-not $qprocs -or @($qprocs).Count -eq 0) {
    # 进程没开 -> 确定没透明
    if ($Json) { Write-Output '{"hwnd":null,"alpha":null,"layered":false}' }
    else { Write-Host "[transparent] 没找到进程 '$ProcessName'。" }
    exit 2
  }
  $qpidSet = @($qprocs).Id
  $qpidPtr = @($qpidSet | ForEach-Object { [IntPtr]$_ })
  $qraw = [WinEnum]::Dump($qpidPtr)
  $qwindows = foreach ($line in $qraw) {
    $p = $line -split '\|'; $size = $p[4] -split 'x'
    [pscustomobject]@{ hwnd=[long]$p[0]; width=[int]$size[0]; height=[int]$size[1]; toplevel=($p[5] -eq "1") }
  }
  $qcand = @($qwindows | Where-Object { $_.toplevel -and $_.width -gt 0 -and $_.height -gt 0 } |
             Sort-Object { $_.width * $_.height } -Descending)
  if ($qcand.Count -eq 0) {
    # 进程在跑但无可见顶层窗口 -> 无法确定 (unknown 场景之一)
    if ($Json) { Write-Output '{"hwnd":null,"alpha":null,"layered":false}' }
    else { Write-Host "[transparent] 进程在跑但无可见顶层窗口。" }
    exit 2
  }
  $qchosen = $qcand[0]   # 面积最大，自动选，不 read-host
  $qh = [IntPtr]$qchosen.hwnd
  $qr = Get-Alpha-Info $qh
  $obj = @{ hwnd = [long]$qchosen.hwnd; alpha = $(if ($qr.layered) { $qr.alpha } else { $null });
            opacityPct = $(if ($qr.layered) { [Math]::Round($qr.alpha / 255 * 100) } else { $null });
            layered = $qr.layered }
  if ($Json) { Write-Output ($obj | ConvertTo-Json -Compress) }
  else { Write-Host ("hwnd=" + $qchosen.hwnd + " layered=" + $qr.layered + " alpha=" + $qr.alpha) }
  exit 0
}

# ---- 1) 找目标进程的 PID 集合 (set 流程) ----
$procs = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
if (-not $procs -or @($procs).Count -eq 0) {
  Write-Host "[transparent] 没找到进程 '$ProcessName'。" -ForegroundColor Yellow
  Write-Host "[transparent] 用 Get-Process 看真实进程名 (Electron 应用可能叫别的)，"
  Write-Host "[transparent] 然后: powershell -File transparent.ps1 -ProcessName <真实名>"
  exit 1
}
$pidSet = @($procs).Id

$pidPtr = @($pidSet | ForEach-Object { [IntPtr]$_ })
$raw = [WinEnum]::Dump($pidPtr)
# 解析成对象数组 (对齐 windowselect.cjs 的 shape)
# C# Dump format: hwnd|pid|cls|title|<WxH>|<ownerFlag>
#   index:        0   1   2   3      4       5
# 所以 size 在 [4]，toplevel(owner==1) 在 [5]。别再数错字段了。
$windows = foreach ($line in $raw) {
  $p = $line -split '\|'
  $size = $p[4] -split 'x'
  [pscustomobject]@{
    hwnd      = [long]$p[0]
    pid       = [int]$p[1]
    className = $p[2]
    title     = $p[3]
    width     = [int]$size[0]
    height    = [int]$size[1]
    visible   = $true       # EnumWindows+IsWindowVisible 已过滤
    toplevel  = ($p[5] -eq "1")
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

# ---- 3) 设透明 (设完即退，不阻塞、不监听热键) ----
function Set-Alpha($h, $a) {
  $style = [Win32]::GetWindowLong($h, $GWL_EXSTYLE)
  [Win32]::SetWindowLong($h, $GWL_EXSTYLE, $style -bor $WS_EX_LAYERED) | Out-Null
  [Win32]::SetLayeredWindowAttributes($h, 0, $a, $LWA_ALPHA) | Out-Null
}

Set-Alpha $hwnd $alpha
if ($alpha -ge 255) {
  # 恢复不透明：alpha=255 后把 layered 也剥掉，回到原样
  $style = [Win32]::GetWindowLong($hwnd, $GWL_EXSTYLE)
  [Win32]::SetWindowLong($hwnd, $GWL_EXSTYLE, $style -band (-bnot $WS_EX_LAYERED)) | Out-Null
  Write-Host "[transparent] 已恢复完全不透明 (Opacity=100%)。"
} else {
  Write-Host "[transparent] 已设透明 alpha=$alpha/255 (Opacity=$Opacity%)。"
}
# -Json：额外打印一行机器可读的 {event:set,hwnd,alpha,opacityPct}，让 control
# server 能建立"setTransparent -> 后续 -Query -Hwnd"链路 (spec §4 A3 改动3)。
if ($Json) {
  $setObj = @{ event = "set"; hwnd = [long]$chosen.hwnd; alpha = $alpha; opacityPct = $Opacity }
  Write-Output ($setObj | ConvertTo-Json -Compress)
}
Write-Host "[transparent] 完成。要改透明度重跑此脚本，要恢复用 -Opacity 100。"
exit 0
