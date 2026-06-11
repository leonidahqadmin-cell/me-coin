# ME COIN — daily execution log (precondition 10).
# Appends one line per repo per day with founder-authored commit counts across
# ALL local repos, then commits and pushes the log. The log reports everything,
# so a hand-commit to any sibling repo publishes itself — the mechanism is
# auto-generated, never curated.
#
# Schedule daily (run from an elevated prompt once):
#   schtasks /create /tn "MECOIN Execution Log" /tr "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Nicholas\me-coin\scripts\execution-log.ps1" /sc daily /st 23:50

$ErrorActionPreference = 'Continue'
$repoRoot = 'C:\Users\Nicholas'
$logRepo  = Join-Path $repoRoot 'me-coin'
$logFile  = Join-Path $logRepo 'docs\LOG.md'
$today    = Get-Date -Format 'yyyy-MM-dd'

if (-not (Test-Path (Split-Path $logFile))) { New-Item -ItemType Directory -Force (Split-Path $logFile) | Out-Null }
if (-not (Test-Path $logFile)) {
  "# Execution log`n`nAuto-generated daily. One line per repo per day: founder-authored commits in the last 24h.`nThis file is written by scripts/execution-log.ps1 and is not curated.`n" |
    Out-File $logFile -Encoding utf8
}

$lines = @()
Get-ChildItem $repoRoot -Directory | ForEach-Object {
  $dir = $_.FullName
  if (Test-Path (Join-Path $dir '.git')) {
    $n = (git -C $dir log --since='24 hours ago' --author='Nicholas' --oneline 2>$null | Measure-Object -Line).Lines
    if ($n -gt 0) { $lines += "- $today | $($_.Name) | $n founder commit(s)" }
  }
}
if ($lines.Count -eq 0) { $lines = @("- $today | (no founder commits in any repo)") }

Add-Content -Path $logFile -Value ($lines -join "`n") -Encoding utf8

git -C $logRepo add docs/LOG.md
git -C $logRepo commit -m "log: $today execution log" 2>$null
git -C $logRepo push origin master 2>$null
