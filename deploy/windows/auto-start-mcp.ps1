[CmdletBinding()]
param(
  [string]$ProjectRoot = "D:\Servers\calorie-tracker-codex-refactored",
  [string]$EnvFile = "D:\Servers\calorie-tracker-codex-refactored\.env.production",
  [int]$Port = 8787
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$logDir = Join-Path $ProjectRoot "logs"
$logFile = Join-Path $logDir "startup.log"
if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

function Write-Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $logFile -Value $line
}

function Wait-ForDocker {
  $ready = $false
  for ($i = 0; $i -lt 180; $i++) {
    docker info *> $null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 2
  }

  if (-not $ready) {
    throw "Docker engine did not become ready in time."
  }
}

try {
  Write-Log "Auto-start sequence started."

  $rdctl = "C:\Program Files\Rancher Desktop\resources\resources\win32\bin\rdctl.exe"
  if (Test-Path -LiteralPath $rdctl) {
    $rdStartCommand = "`"$rdctl`" start --application.auto-start --application.start-in-background --no-modal-dialogs"
    cmd.exe /c "$rdStartCommand >nul 2>nul"
    if ($LASTEXITCODE -eq 0) {
      Write-Log "Requested Rancher Desktop start."
    } else {
      Write-Log "rdctl start returned exit code $LASTEXITCODE; continuing."
    }
  } else {
    Write-Log "rdctl not found. Skipping explicit Rancher start."
  }

  Wait-ForDocker
  Write-Log "Docker engine is ready."

  $currentContext = (docker context show 2>$null).Trim()
  if ($currentContext -ne "default") {
    docker context use default 1>$null 2>$null
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to switch Docker context to default."
    }
  }
  Write-Log "Docker context verified as default."

  if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Missing env file: $EnvFile"
  }

  $composeCommand = "docker compose --project-directory ""$ProjectRoot"" --env-file ""$EnvFile"" up -d"
  cmd.exe /c "$composeCommand >nul 2>nul"
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose up failed with exit code $LASTEXITCODE."
  }
  Write-Log "Docker compose stack ensured."

  $healthUrl = "http://127.0.0.1:$Port/health"
  $healthy = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      $response = Invoke-RestMethod -Method Get -Uri $healthUrl -TimeoutSec 2
      if ($response.status -eq "ok") {
        $healthy = $true
        break
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  if (-not $healthy) {
    throw "MCP service did not become healthy at $healthUrl"
  }
  Write-Log "Health check passed at $healthUrl."

  cmd.exe /c "tailscale status >nul 2>nul"
  if ($LASTEXITCODE -eq 0) {
    cmd.exe /c "tailscale funnel --bg http://127.0.0.1:$Port >nul 2>nul"
    if ($LASTEXITCODE -ne 0) {
      throw "tailscale funnel command failed with exit code $LASTEXITCODE."
    }
    Write-Log "Tailscale funnel ensured for port $Port."
  } else {
    Write-Log "Tailscale not ready. Funnel step skipped."
  }

  Write-Log "Auto-start sequence completed successfully."
} catch {
  Write-Log "Auto-start failed: $($_.Exception.Message)"
  exit 1
}
