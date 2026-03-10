# Railway Deployment Checklist

Use this checklist to ensure a successful Railway deployment.

## Pre-Deployment

- [ ] Code is pushed to GitHub/GitLab
- [ ] `railway.toml` exists in repository root
- [ ] `.gitignore` excludes `.env`, `data/`, and `node_modules/`
- [ ] Railway account created (https://railway.app)

## Deployment Steps

### 1. Create Railway Project
- [ ] Login to Railway dashboard
- [ ] Click "New Project"
- [ ] Select "Deploy from GitHub repo"
- [ ] Authenticate with GitHub
- [ ] Select your repository

### 2. Configure Environment Variables

Generate secure credentials first:
```bash
# Generate ADMIN_API_KEY
openssl rand -hex 32

# Or use a password generator for both API key and password
```

Add these variables in Railway dashboard (Settings → Variables):

- [ ] `PORT` = `8787`
- [ ] `DATABASE_PATH` = `/app/data/calorie-tracker.db`
- [ ] `NODE_ENV` = `production`
- [ ] `ADMIN_API_KEY` = `<your-32-char-random-string>`
- [ ] `ADMIN_EMAIL` = `admin@yourdomain.com`
- [ ] `ADMIN_PASSWORD` = `<your-strong-password>`
- [ ] `SESSION_TTL_HOURS` = `168`
- [ ] `BASE_URL` = `https://${{RAILWAY_PUBLIC_DOMAIN}}`

### 3. Generate Public Domain
- [ ] Go to Settings → Networking
- [ ] Click "Generate Domain"
- [ ] Copy the domain (e.g., `your-app.railway.app`)

### 4. Wait for Deployment
- [ ] Check Deployments tab
- [ ] Verify build succeeds
- [ ] Verify health check passes
- [ ] Check logs for any errors

## Post-Deployment Verification

### Test Health Endpoint
```bash
curl https://YOUR_DOMAIN.railway.app/health
```
- [ ] Returns `{"status": "ok", ...}`

### Test OpenAPI Spec
```bash
curl https://YOUR_DOMAIN.railway.app/openapi.json
```
- [ ] Returns OpenAPI JSON

### Test OAuth Metadata
```bash
curl https://YOUR_DOMAIN.railway.app/.well-known/oauth-authorization-server
```
- [ ] Returns OAuth configuration

### Test Web Dashboard
- [ ] Visit `https://YOUR_DOMAIN.railway.app/`
- [ ] Visit `https://YOUR_DOMAIN.railway.app/login`
- [ ] Login with admin credentials
- [ ] Verify dashboard loads
- [ ] Generate API token
- [ ] Save API token securely

## MCP Client Setup

### Register OAuth Client
```bash
curl -X POST https://YOUR_DOMAIN.railway.app/oauth/register \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_ADMIN_API_KEY" \
  -d '{
    "client_name": "Claude Desktop",
    "redirect_uris": ["http://127.0.0.1/callback"],
    "user_id": "admin"
  }'
```

- [ ] Save `client_id` and `client_secret`

### Configure Claude Desktop

File: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
Or: `%APPDATA%\Claude\claude_desktop_config.json` (Windows)

```json
{
  "mcpServers": {
    "calorie-tracker": {
      "url": "https://YOUR_DOMAIN.railway.app/mcp",
      "authorization": {
        "type": "oauth2",
        "oauth2": {
          "authorizationUrl": "https://YOUR_DOMAIN.railway.app/oauth/authorize",
          "tokenUrl": "https://YOUR_DOMAIN.railway.app/oauth/token",
          "clientId": "YOUR_CLIENT_ID",
          "clientSecret": "YOUR_CLIENT_SECRET",
          "scope": ""
        }
      }
    }
  }
}
```

- [ ] Config file updated
- [ ] Restart Claude Desktop
- [ ] Verify MCP tools appear

### Test MCP Tools

In Claude Desktop, try these commands:
- [ ] "Get my calorie tracker profile"
- [ ] "Add a food entry: chicken breast, 200g, 330 calories"
- [ ] "List my entries for today"

## Security Review

- [ ] ADMIN_API_KEY is strong (32+ random characters)
- [ ] ADMIN_PASSWORD is strong
- [ ] BASE_URL uses HTTPS
- [ ] OAuth client secrets saved securely
- [ ] API tokens saved securely
- [ ] Access logs reviewed for suspicious activity

## Monitoring Setup

- [ ] Enable Railway notifications for deployment failures
- [ ] Set up uptime monitoring (optional, e.g., UptimeRobot)
- [ ] Bookmark Railway logs page
- [ ] Set calendar reminder to check logs weekly

## Backup Plan (Optional)

Consider setting up automated backups:
- [ ] Create backup script (export SQLite to S3/GCS)
- [ ] Schedule backups (cron or Railway Cron)
- [ ] Test backup restore process

## Troubleshooting

If deployment fails:
1. Check build logs in Deployments tab
2. Verify all environment variables are set
3. Check Railway service status
4. Review application logs
5. Verify Dockerfile builds locally: `docker build -t test .`

If OAuth fails:
1. Verify BASE_URL matches Railway domain exactly
2. Check ADMIN_API_KEY is correct
3. Verify client credentials are correct
4. Check browser console for errors during OAuth flow

If database is empty after restart:
1. This is expected on Railway free tier (ephemeral storage)
2. Consider upgrading to Railway Pro for persistent volumes
3. Or implement automated backups to external storage

## Success Criteria

✅ All items checked
✅ Health endpoint returns 200 OK
✅ Can login to web dashboard
✅ MCP tools work in Claude Desktop
✅ No errors in Railway logs

**Congratulations! Your Calorie Tracker MCP Server is deployed on Railway! 🚂**
