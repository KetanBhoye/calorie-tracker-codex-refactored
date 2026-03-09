# Windows Laptop Deployment (Docker + Tailscale Funnel)

This guide deploys the MCP server on a Windows laptop with free public HTTPS via Tailscale Funnel. It is designed for Claude and ChatGPT OAuth connectors.

## 1) Host readiness

1. Set Windows power options so the laptop never sleeps while plugged in.
2. Install Docker Desktop and Tailscale.
3. Enable auto-start for both Docker Desktop and Tailscale.
4. Clone this repo on the laptop and open PowerShell in the repo root.

## 2) Configure production env

```powershell
Copy-Item .env.production.example .env.production
```

Edit `.env.production` and set strong values:

- `PORT=8787`
- `DATABASE_PATH=/data/calorie-tracker.db`
- `ADMIN_API_KEY=<strong secret>`
- `ADMIN_EMAIL=<admin email>`
- `ADMIN_PASSWORD=<strong password>`
- `BASE_URL=https://replace-after-funnel`

## 3) Start Docker stack

```powershell
.\deploy\windows\start-stack.ps1
```

This script:
- starts the stack with `docker compose`
- confirms restart policy (`unless-stopped`)
- checks local health at `http://127.0.0.1:8787/health`

## 4) Publish HTTPS with Tailscale Funnel

Login to Tailscale first:

```powershell
tailscale up
```

Start Funnel:

```powershell
.\deploy\windows\start-funnel.ps1 -Port 8787
```

Copy the HTTPS URL shown by the script, then set `BASE_URL`:

```powershell
.\deploy\windows\set-base-url.ps1 -BaseUrl "https://<your-funnel-domain>"
.\deploy\windows\start-stack.ps1
```

## 5) Validate deployment (acceptance test)

Run the full acceptance suite (health, persistence, OAuth, MCP initialize, tools/list):

```powershell
.\deploy\windows\run-acceptance.ps1 -PublicBaseUrl "https://<your-funnel-domain>"
```

Equivalent direct Node command:

```powershell
node .\deploy\windows\acceptance-test.mjs `
  --base-url http://127.0.0.1:8787 `
  --public-base-url https://<your-funnel-domain> `
  --admin-api-key <admin-api-key> `
  --admin-email <admin-email> `
  --admin-password <admin-password> `
  --compose-project-dir .
```

## 6) Register separate OAuth clients

Use one client for Claude and one client for ChatGPT.

### Claude client

In Claude connector setup, copy the callback URI Claude gives you, then run:

```powershell
.\deploy\windows\register-oauth-client.ps1 `
  -BaseUrl "https://<your-funnel-domain>" `
  -AdminApiKey "<admin-api-key>" `
  -ClientName "Claude MCP" `
  -RedirectUris "<claude-callback-uri>"
```

Set MCP URL to:

- `https://<your-funnel-domain>/mcp`

### ChatGPT client

In ChatGPT connector/app setup, copy the exact ChatGPT redirect URI, then run:

```powershell
.\deploy\windows\register-oauth-client.ps1 `
  -BaseUrl "https://<your-funnel-domain>" `
  -AdminApiKey "<admin-api-key>" `
  -ClientName "ChatGPT MCP" `
  -RedirectUris "<chatgpt-redirect-uri>"
```

Set MCP URL to:

- `https://<your-funnel-domain>/mcp`

## 7) Backups and hardening

Create a backup immediately:

```powershell
.\deploy\windows\backup-sqlite.ps1
```

Schedule daily backup:

```powershell
.\deploy\windows\create-backup-task.ps1 -DailyAt "02:00"
```

Recommended operations:
- rotate `ADMIN_API_KEY` periodically
- rotate user/API tokens from dashboard periodically
- do not use router port-forwarding
- use only Tailscale Funnel for public exposure

## Interfaces

- MCP: `POST/GET/DELETE /mcp`
- Legacy MCP transport: `GET /sse`, `POST /messages`
- OAuth: `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `/oauth/authorize`, `/oauth/token`, `/oauth/register`
- Web: `/signup`, `/login`, `/dashboard`
