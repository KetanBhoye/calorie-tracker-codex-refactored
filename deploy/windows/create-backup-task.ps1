[CmdletBinding()]
param(
  [string]$TaskName = "CalorieTrackerSqliteBackup",
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$DailyAt = "02:00"
)

$ErrorActionPreference = "Stop"

$backupScript = Join-Path $PSScriptRoot "backup-sqlite.ps1"
if (-not (Test-Path -LiteralPath $backupScript)) {
  throw "Missing script: $backupScript"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupScript`" -ProjectRoot `"$ProjectRoot`""

$trigger = New-ScheduledTaskTrigger -Daily -At $DailyAt
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType InteractiveToken -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force | Out-Null

Write-Host "Scheduled task '$TaskName' created. Runs daily at $DailyAt."
