[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$EnvFile
)

$ErrorActionPreference = "Stop"

if (-not $EnvFile) {
  $EnvFile = Join-Path $ProjectRoot ".env.production"
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  throw "Env file not found: $EnvFile"
}

if ($BaseUrl -notmatch '^https://') {
  throw "BASE_URL must be HTTPS for Claude/ChatGPT OAuth."
}

$lines = Get-Content -LiteralPath $EnvFile
$updated = $false

for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^\s*BASE_URL=') {
    $lines[$i] = "BASE_URL=$BaseUrl"
    $updated = $true
  }
}

if (-not $updated) {
  $lines += "BASE_URL=$BaseUrl"
}

Set-Content -LiteralPath $EnvFile -Value $lines
Write-Host "Updated BASE_URL in $EnvFile"
Write-Host "Restart service: docker compose --project-directory `"$ProjectRoot`" --env-file `"$EnvFile`" up -d"
