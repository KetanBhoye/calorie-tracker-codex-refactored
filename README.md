# Calorie Tracker MCP Server (Portable Refactor)

Portable MCP server for calorie tracking with a built-in web dashboard.

This version removes all Cloudflare dependencies and runs anywhere Node.js runs:
- private VPS
- Docker/Kubernetes
- Render/Railway/Fly.io
- on-prem Linux server

## What You Get

- MCP tools for food tracking + profile/BMR/TDEE analytics
- Streamable HTTP MCP endpoint (`/mcp`) and legacy SSE MCP endpoint (`/sse` + `/messages`)
- OAuth endpoints for remote MCP connectors (`/oauth/*` + metadata)
- Web signup/login/session auth
- Dashboard for profile, weight/body-fat tracking, and daily entries
- SQLite persistence with automatic migrations

## Tech Stack

- Runtime: Node.js + Express
- Database: SQLite (`better-sqlite3`)
- MCP: `@modelcontextprotocol/sdk`
- Language: TypeScript
- Validation: Zod
- Testing: Vitest + Supertest

## Quick Start

```bash
pnpm install
cp .env.example .env # optional
pnpm db:migrate
pnpm dev
```

Server starts at `http://localhost:8787` by default.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8787` | Server port |
| `DATABASE_PATH` | `./data/calorie-tracker.db` | SQLite DB path |
| `ADMIN_API_KEY` | `change-this-admin-key` | Required for `/oauth/register` |
| `ADMIN_EMAIL` | `admin@calorie-tracker.local` | Seeded admin email |
| `ADMIN_PASSWORD` | `admin123456` | Seeded admin password (change in production) |
| `SESSION_TTL_HOURS` | `168` | Web session lifetime |
| `BASE_URL` | `http://localhost:<PORT>` | Public server URL for OAuth metadata |

## MCP Endpoints

- `POST/GET/DELETE /mcp` (Streamable HTTP)
- `GET /sse` + `POST /messages?sessionId=...` (legacy SSE)

Authentication: `Authorization: Bearer <token>`

Bearer token can be:
- OAuth access token from `/oauth/token`
- OAuth client secret from `/oauth/register`
- User API token generated in dashboard (`Generate API Token`)

## OAuth Endpoints

- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-protected-resource`
- `GET /oauth/authorize`
- `POST /oauth/token`
- `POST /oauth/register`

Register client example:

```bash
curl -X POST http://localhost:8787/oauth/register \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_ADMIN_API_KEY" \
  -d '{
    "client_name": "Claude Desktop",
    "redirect_uris": ["http://127.0.0.1/callback"],
    "user_id": "admin"
  }'
```

## Dashboard

- `/signup` - create user
- `/login` - sign in
- `/dashboard` - profile + entries + token generation

## Integrating with Claude / ChatGPT

### Claude (Bearer token)

```json
{
  "mcpServers": {
    "calorie-tracker": {
      "command": "npx",
      "args": ["mcp-remote", "http://YOUR_HOST:8787/sse"],
      "env": {
        "BEARER_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

### OAuth-capable MCP clients

Use:
- Resource/MCP URL: `https://YOUR_HOST/mcp`
- OAuth metadata: `https://YOUR_HOST/.well-known/oauth-authorization-server`
- Register separate OAuth clients per platform (`Claude` and `ChatGPT`) using `/oauth/register`.

## Deploy Anywhere

### 1) Direct Node deployment

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
NODE_ENV=production PORT=8787 DATABASE_PATH=/var/lib/calorie-tracker/db.sqlite ADMIN_API_KEY=... pnpm start
```

### 2) Docker

```bash
docker build -t calorie-tracker-mcp .
docker run -p 8787:8787 \
  -e ADMIN_API_KEY=change-me \
  -e DATABASE_PATH=/data/calorie-tracker.db \
  -v calorie-data:/data \
  calorie-tracker-mcp
```

### 3) Windows laptop + Tailscale Funnel (free HTTPS)

- Full deployment guide: `deploy/windows/README.md`
- Production env template: `.env.production.example`
- One-command stack start: `deploy/windows/start-stack.ps1`
- Funnel setup: `deploy/windows/start-funnel.ps1`
- Full acceptance test (health, persistence, OAuth, MCP): `deploy/windows/run-acceptance.ps1`

## Scripts

- `pnpm dev` - run with watcher
- `pnpm start` - run production server
- `pnpm db:migrate` - apply migrations + admin seed
- `pnpm test` - run tests
- `pnpm type-check` - TypeScript check
- `node deploy/windows/acceptance-test.mjs ...` - deployment acceptance checks

## Core MCP Tools

- `get_user_preferences`
- `set_user_preferences`
- `list_entries`
- `add_entry`
- `update_entry`
- `delete_entry`
- `get_profile`
- `update_profile`
- `get_profile_history`
- `add_body_measurement`
- `list_body_measurements`
- `add_progress_photo`
- `list_progress_photos`
- `compare_progress`
- `register_user` (admin)
- `revoke_user` (admin)
