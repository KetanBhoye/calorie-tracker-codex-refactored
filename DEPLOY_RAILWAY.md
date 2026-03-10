# 🚂 Quick Railway Deployment Guide

Deploy your Calorie Tracker MCP Server to Railway's free plan in under 10 minutes.

## 🎯 Prerequisites

- Railway account: https://railway.app (free $5/month credit)
- GitHub account with this repo pushed
- 5-10 minutes of your time

## 🚀 Quick Deploy (3 Steps)

### Step 1: Push to GitHub

```bash
git add .
git commit -m "Prepare for Railway deployment"
git push origin main
```

### Step 2: Deploy on Railway

1. Go to https://railway.app/new
2. Click "Deploy from GitHub repo"
3. Authenticate and select your repository
4. Railway auto-detects Dockerfile and starts building

### Step 3: Configure Variables

Click on your service → **Variables** tab → Add these:

```bash
PORT=8787
DATABASE_PATH=/app/data/calorie-tracker.db
NODE_ENV=production
ADMIN_API_KEY=<generate-with: openssl rand -hex 32>
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=<your-strong-password>
SESSION_TTL_HOURS=168
BASE_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
```

**Generate secure keys:**
```bash
# Generate ADMIN_API_KEY
openssl rand -hex 32
```

### Step 4: Generate Domain

Go to **Settings** → **Networking** → Click **"Generate Domain"**

Your app will be live at: `https://your-app-name.railway.app`

## ✅ Verify Deployment

```bash
# Replace YOUR_DOMAIN with your Railway domain
curl https://YOUR_DOMAIN.railway.app/health
```

Should return:
```json
{"status":"ok","service":"calorie-tracker-mcp-server","timestamp":"..."}
```

## 🔐 Set Up MCP Client

### 1. Register OAuth Client

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

Save the `client_id` and `client_secret`.

### 2. Configure Claude Desktop

Edit: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)

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

### 3. Restart Claude Desktop

Your MCP server is now connected!

## 📊 Test in Claude

Try these commands:
- "Get my calorie tracker profile"
- "Add a food entry: apple, 150g, 80 calories"
- "List my entries for today"
- "Show my BMR and TDEE"

## 🎓 Alternative: Deploy via CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up

# Set variables
railway variables set ADMIN_API_KEY=$(openssl rand -hex 32)
railway variables set ADMIN_EMAIL=admin@yourdomain.com
railway variables set ADMIN_PASSWORD=your-password
railway variables set DATABASE_PATH=/app/data/calorie-tracker.db
railway variables set SESSION_TTL_HOURS=168
railway variables set NODE_ENV=production
railway variables set BASE_URL=https://$(railway domain)

# Deploy
railway up --detach
```

## 📖 Detailed Documentation

- **Full deployment guide**: `deploy/railway/README.md`
- **Deployment checklist**: `deploy/railway/CHECKLIST.md`
- **Test script**: `deploy/railway/test-deployment.sh`

## ⚠️ Important Notes

### Free Tier Limitations
- **$5/month free credit** (sufficient for personal use)
- **Ephemeral storage**: Database persists during normal operation but may be reset if service is deleted
- For production: upgrade to Railway Pro for persistent volumes

### Security
- ✅ Use strong random keys for `ADMIN_API_KEY` (32+ chars)
- ✅ Use strong password for `ADMIN_PASSWORD`
- ✅ HTTPS is automatic (Railway provides SSL)
- ✅ Rotate secrets regularly

### Database Persistence
Railway free tier uses ephemeral storage. Your database will persist across:
- ✅ Normal deployments
- ✅ Code updates
- ✅ Restarts

But may be reset if:
- ❌ Service is deleted
- ❌ Significant downtime/migration

**For production**: Consider Railway Pro or implement automated backups.

## 🐛 Troubleshooting

### Deployment Failed
- Check **Deployments** tab for build logs
- Verify all environment variables are set
- Ensure `railway.toml` is committed

### Can't Connect to MCP
- Verify `BASE_URL` is set to Railway domain (with https://)
- Check OAuth credentials are correct
- Review logs in Railway dashboard

### Database Reset
- Expected on free tier after service deletion
- Consider upgrading to Railway Pro
- Or implement automated backups to S3/GCS

## 💰 Cost Estimate

With Railway free tier ($5/month credit):
- **Light usage** (personal): Free ✅
- **Moderate usage** (small team): ~$2-3/month
- **Heavy usage** (production): Consider Railway Pro ($20/month + usage)

## 📞 Support

- **Railway Docs**: https://docs.railway.app/
- **Railway Discord**: https://discord.gg/railway
- **Issues**: https://github.com/YOUR_USERNAME/calorie-tracker-codex-refactored/issues

---

**🎉 Enjoy your deployed MCP server!**

Test deployment:
```bash
./deploy/railway/test-deployment.sh https://YOUR_DOMAIN.railway.app
```
