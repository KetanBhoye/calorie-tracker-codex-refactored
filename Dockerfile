FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile --prod=false

# Copy application files
COPY . .

# Set default environment (can be overridden)
ENV NODE_ENV=production
ENV PORT=8787
ENV DATABASE_PATH=/app/data/calorie-tracker.db

# Create data directory for Railway ephemeral storage
RUN mkdir -p /app/data

EXPOSE 8787

# Migrations run automatically on startup (see src/index.ts)
CMD ["pnpm", "start"]
