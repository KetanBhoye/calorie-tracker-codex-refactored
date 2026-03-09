[CmdletBinding()]
param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$ServiceName = "calorie-tracker-mcp",
  [string]$OutputDir,
  [int]$KeepDays = 30
)

$ErrorActionPreference = "Stop"

if (-not $OutputDir) {
  $OutputDir = Join-Path $ProjectRoot "backups"
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$containerId = (docker compose --project-directory $ProjectRoot ps -q $ServiceName).Trim()
if (-not $containerId) {
  throw "Unable to resolve container for service '$ServiceName'."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = Join-Path $OutputDir "calorie-tracker-$timestamp.db"

docker cp "${containerId}:/data/calorie-tracker.db" $backupFile

Write-Host "Backup created: $backupFile"

if ($KeepDays -gt 0) {
  $cutoff = (Get-Date).AddDays(-$KeepDays)
  Get-ChildItem -Path $OutputDir -Filter "calorie-tracker-*.db" |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    Remove-Item -Force
}
