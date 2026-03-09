FROM node:22-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --no-frozen-lockfile

COPY . .

ENV NODE_ENV=production
ENV PORT=8787
ENV DATABASE_PATH=/data/calorie-tracker.db

VOLUME ["/data"]
EXPOSE 8787

CMD ["pnpm", "start"]
