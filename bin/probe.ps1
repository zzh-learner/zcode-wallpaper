# probe.ps1 - shared debug-port probe logic used by start-zcode.bat and inject-only.bat
# ----------------------------------------------------------
# Hits http://127.0.0.1:$Port/json and exits:
#   0  -> port open AND at least one "page" target is present (ready to inject)
#   2  -> port open but no page target yet (window not ready)
#   1  -> could not reach the port (connection refused / timeout)
#
# CRITICAL: the Where-Object result MUST be wrapped in @(...) before .Count.
# When exactly ONE page target exists (the common "already running" case),
# Where-Object returns the single object, not an array, and its .Count is $null.
# $null -gt 0 is $false, so without @(...) this would always exit 2 and
# inject.cjs would NEVER run. (See AGENTS.md "PowerShell 单对象 .Count 是 null".)
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File probe.ps1 -Port 9222
param(
  [int]$Port = 9222
)

try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:" + $Port + "/json") -TimeoutSec 2
  $t = $r.Content | ConvertFrom-Json
  # @(...) forces an array even when Where-Object returns a single object.
  if (@($t | Where-Object { $_.type -eq 'page' }).Count -gt 0) {
    exit 0
  } else {
    exit 2
  }
} catch {
  exit 1
}
