# Ensure a .bat file has CRLF line endings (AGENTS.md: LF .bat files break cmd).
$paths = @("$PSScriptRoot\..\bin\control-center.bat", "$PSScriptRoot\..\wallpaper.bat", "$PSScriptRoot\..\start.bat")
foreach ($p in $paths) {
  $bytes = [System.IO.File]::ReadAllBytes($p)
  $hasCrlf = $false
  for ($i = 0; $i -lt $bytes.Length - 1; $i++) {
    if ($bytes[$i] -eq 0x0D -and $bytes[$i + 1] -eq 0x0A) { $hasCrlf = $true; break }
  }
  if (-not $hasCrlf) {
    $text = [System.IO.File]::ReadAllText($p)
    $text = $text -replace "`r`n", "`n"
    $text = $text -replace "`n", "`r`n"
    [System.IO.File]::WriteAllText($p, $text, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Converted $p to CRLF"
  } else {
    Write-Host "$p already CRLF"
  }
}
