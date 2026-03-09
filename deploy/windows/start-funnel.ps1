[CmdletBinding()]
param(
  [int]$Port = 8787
)

$ErrorActionPreference = "Stop"

Write-Host "Starting Tailscale Funnel for http://127.0.0.1:$Port ..."
tailscale funnel --bg "http://127.0.0.1:$Port" | Out-Null

$statusText = tailscale funnel status
$urlMatch = [regex]::Match($statusText, 'https://[a-zA-Z0-9.-]+')

if ($urlMatch.Success) {
  Write-Host "Funnel URL: $($urlMatch.Value)"
  Write-Host "Use this as BASE_URL, then restart the Docker service."
} else {
  Write-Host "Funnel started. Run 'tailscale funnel status' to see URL."
}
