[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,
  [Parameter(Mandatory = $true)]
  [string]$AdminApiKey,
  [Parameter(Mandatory = $true)]
  [string]$ClientName,
  [Parameter(Mandatory = $true)]
  [string[]]$RedirectUris,
  [string]$UserId = "admin",
  [string]$Scope = "mcp:tools"
)

$ErrorActionPreference = "Stop"

$uri = "$($BaseUrl.TrimEnd('/'))/oauth/register"
$payload = @{
  client_name = $ClientName
  redirect_uris = $RedirectUris
  user_id = $UserId
  scope = $Scope
} | ConvertTo-Json -Depth 5

$result = Invoke-RestMethod -Method Post -Uri $uri -Headers @{
  "X-API-Key" = $AdminApiKey
} -ContentType "application/json" -Body $payload

Write-Host "OAuth client created:"
$result | ConvertTo-Json -Depth 5
