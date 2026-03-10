# Railway Deployment Guide

Deploy your Calorie Tracker MCP Server to Railway's free plan in minutes.

## Prerequisites

- Railway account (free): https://railway.app/
- GitHub/GitLab account (to connect your repository)
- This repository pushed to GitHub/GitLab

## Quick Deploy

### Option 1: Deploy from GitHub (Recommended)

1. **Push your code to GitHub**
   ```bash
   git add .
   git commit -m "Prepare for Railway deployment"
   git push origin main
   ```

2. **Create a new project on Railway**
   - Go to https://railway.app/
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Authenticate with GitHub if needed
   - Select your calorie-tracker repository

3. **Configure environment variables**

   Railway will auto-detect your Dockerfile. Click on your service and go to the "Variables" tab. Add these:

   ```bash
   # Required variables
   PORT=8787
   DATABASE_PATH=/app/data/calorie-tracker.db
   ADMIN_API_KEY=<generate-strong-32-char-random-string>
   ADMIN_EMAIL=admin@yourdomain.com
   ADMIN_PASSWORD=<generate-strong-password>
   SESSION_TTL_HOURS=168
   BASE_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
   NODE_ENV=production
   ```

   **Important Notes:**
   - `${{RAILWAY_PUBLIC_DOMAIN}}` is a Railway variable that auto-resolves to your deployment URL
   - Generate a strong `ADMIN_API_KEY` (32+ characters): you can use `openssl rand -hex 32`
   - Use a strong `ADMIN_PASSWORD` for the admin account

4. **Generate your domain**
   - Go to the "Settings" tab
   - Scroll to "Networking"
   - Click "Generate Domain" to get a public URL
   - Railway will automatically deploy your app

5. **Wait for deployment**
   - Check the "Deployments" tab to see build progress
   - Once deployed, your MCP server will be available at the generated domain

### Option 2: Deploy via Railway CLI

1. **Install Railway CLI**
   ```bash
   npm install -g @railway/cli
   ```

2. **Login to Railway**
   ```bash
   railway login
   ```

3. **Initialize project**
   ```bash
   railway init
   ```

4. **Add environment variables**
   ```bash
   railway variables set PORT=8787
   railway variables set DATABASE_PATH=/app/data/calorie-tracker.db
   railway variables set ADMIN_API_KEY=$(openssl rand -hex 32)
   railway variables set ADMIN_EMAIL=admin@yourdomain.com
   railway variables set ADMIN_PASSWORD=your-strong-password
   railway variables set SESSION_TTL_HOURS=168
   railway variables set NODE_ENV=production
   ```

5. **Deploy**
   ```bash
   railway up
   ```

6. **Get your URL**
   ```bash
   railway domain
   ```

7. **Set BASE_URL**
   ```bash
   # After getting your domain from the previous command
   railway variables set BASE_URL=https://your-domain.railway.app
   ```

8. **Redeploy to apply BASE_URL**
   ```bash
   railway up --detach
   ```

## Verify Deployment

Once deployed, test your endpoints:

```bash
# Replace YOUR_DOMAIN with your Railway domain

# Health check
curl https://YOUR_DOMAIN.railway.app/health

# OpenAPI spec
curl https://YOUR_DOMAIN.railway.app/openapi.json

# OAuth metadata
curl https://YOUR_DOMAIN.railway.app/.well-known/oauth-authorization-server
```

## Set Up MCP Client

### For Claude Desktop (OAuth)

1. **Register OAuth client**
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

   Save the `client_id` and `client_secret` from the response.

2. **Configure Claude Desktop**

   Edit your Claude Desktop MCP settings (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

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

### For Bearer Token Access (Legacy)

1. **Generate API token via dashboard**
   - Visit `https://YOUR_DOMAIN.railway.app/login`
   - Login with admin credentials
   - Click "Generate API Token"
   - Save the token

2. **Configure MCP client**
   ```json
   {
     "mcpServers": {
       "calorie-tracker": {
         "command": "npx",
         "args": ["mcp-remote", "https://YOUR_DOMAIN.railway.app/sse"],
         "env": {
           "BEARER_TOKEN": "YOUR_TOKEN"
         }
       }
     }
   }
   ```

## Database Persistence

**Important:** Railway's free plan provides ephemeral storage. Your SQLite database will persist across deployments but may be reset if:
- The service is deleted
- There's a significant downtime
- Railway moves your service

For production use, consider:
1. Upgrading to Railway Pro for persistent volumes
2. Using Railway's PostgreSQL addon (requires code changes)
3. Regular database backups via cron job

### Backup Strategy (Optional)

Add a backup endpoint or script that:
1. Copies the SQLite database to a cloud storage (S3, Google Cloud Storage)
2. Runs on a schedule using Railway Cron or external service

## Monitoring

Railway provides built-in monitoring:
- View logs in the "Logs" tab
- Check deployment history in "Deployments"
- Monitor resource usage in "Metrics"

## Troubleshooting

### Deployment fails
- Check build logs in the "Deployments" tab
- Verify all environment variables are set correctly
- Ensure `railway.toml` is in the repository root

### Database issues
- Check that `DATABASE_PATH=/app/data/calorie-tracker.db` is set
- Verify migrations run successfully in deployment logs
- Check disk space (free plan has limited storage)

### OAuth not working
- Verify `BASE_URL` is set to your Railway domain (with https://)
- Check that `ADMIN_API_KEY` is correct
- Ensure you're using the correct client credentials

### Health check failing
- Check if port 8787 is being used (should match `PORT` env var)
- Verify the app is actually starting (check logs)
- Ensure `/health` endpoint is accessible

## Cost Considerations

Railway free plan includes:
- $5 of free usage per month
- 500 hours of execution time
- Shared CPU and memory
- Ephemeral storage

This should be sufficient for personal use and development. For production workloads, consider upgrading to Railway Pro.

## Security Best Practices

1. **Strong credentials**: Use strong, randomly generated values for `ADMIN_API_KEY` and `ADMIN_PASSWORD`
2. **HTTPS only**: Always use HTTPS (Railway provides this automatically)
3. **Rotate secrets**: Regularly rotate your admin API key and passwords
4. **Limit access**: Only share OAuth credentials with trusted clients
5. **Monitor logs**: Regularly check logs for suspicious activity

## Next Steps

- [ ] Deploy to Railway
- [ ] Set up OAuth client for Claude Desktop
- [ ] Test all MCP tools
- [ ] Configure daily backup (optional)
- [ ] Set up monitoring alerts (optional)

## Support

- Railway docs: https://docs.railway.app/
- Railway Discord: https://discord.gg/railway
- Project issues: https://github.com/YOUR_USERNAME/calorie-tracker-codex-refactored/issues
