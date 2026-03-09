[CmdletBinding()]
param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$BaseUrl = "http://127.0.0.1:8787",
  [string]$PublicBaseUrl,
  [string]$EnvFile,
  [string]$ServiceName = "calorie-tracker-mcp"
)

$ErrorActionPreference = "Stop"

if (-not $EnvFile) {
  $EnvFile = Join-Path $ProjectRoot ".env.production"
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  throw "Env file not found: $EnvFile"
}

$envVars = @{}
Get-Content -LiteralPath $EnvFile |
  Where-Object { $_ -and -not $_.StartsWith('#') -and $_.Contains('=') } |
  ForEach-Object {
    $parts = $_.Split('=', 2)
    $envVars[$parts[0].Trim()] = $parts[1].Trim()
  }

if (-not $envVars.ContainsKey('ADMIN_API_KEY') -or -not $envVars.ContainsKey('ADMIN_EMAIL') -or -not $envVars.ContainsKey('ADMIN_PASSWORD')) {
  throw "ADMIN_API_KEY, ADMIN_EMAIL, and ADMIN_PASSWORD must be present in $EnvFile"
}

$scriptPath = Join-Path $PSScriptRoot "acceptance-test.mjs"
if (-not (Test-Path -LiteralPath $scriptPath)) {
  throw "Missing script: $scriptPath"
}

$args = @(
  $scriptPath,
  "--base-url", $BaseUrl,
  "--admin-api-key", $envVars['ADMIN_API_KEY'],
  "--admin-email", $envVars['ADMIN_EMAIL'],
  "--admin-password", $envVars['ADMIN_PASSWORD'],
  "--compose-project-dir", $ProjectRoot,
  "--service-name", $ServiceName
)

if ($PublicBaseUrl) {
  $args += @("--public-base-url", $PublicBaseUrl)
}

node @args
