[CmdletBinding()]
param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$EnvFile,
  [int]$Port = 8787,
  [string]$ServiceName = "calorie-tracker-mcp"
)

$ErrorActionPreference = "Stop"

if (-not $EnvFile) {
  $EnvFile = Join-Path $ProjectRoot ".env.production"
}

$templateFile = Join-Path $ProjectRoot ".env.production.example"
if (-not (Test-Path -LiteralPath $EnvFile)) {
  if (-not (Test-Path -LiteralPath $templateFile)) {
    throw "Missing $EnvFile and $templateFile."
  }

  Copy-Item -LiteralPath $templateFile -Destination $EnvFile
  throw "Created $EnvFile from template. Fill in secrets first, then rerun this script."
}

Write-Host "Starting Docker stack from $ProjectRoot using $EnvFile ..."
docker compose --project-directory $ProjectRoot --env-file $EnvFile up -d --build

$containerId = (docker compose --project-directory $ProjectRoot ps -q $ServiceName).Trim()
if (-not $containerId) {
  throw "Unable to resolve container for service '$ServiceName'."
}

$restartPolicy = (docker inspect -f "{{.HostConfig.RestartPolicy.Name}}" $containerId).Trim()
$healthState = (docker inspect -f "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}" $containerId).Trim()

Write-Host "Container: $containerId"
Write-Host "Restart policy: $restartPolicy"
Write-Host "Health status: $healthState"

$healthUrl = "http://127.0.0.1:$Port/health"
$maxAttempts = 30
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
  try {
    $response = Invoke-RestMethod -Method Get -Uri $healthUrl -TimeoutSec 2
    if ($response.status -eq "ok") {
      Write-Host "Health check OK at $healthUrl"
      exit 0
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}

throw "Service did not become healthy at $healthUrl after $maxAttempts attempts."
