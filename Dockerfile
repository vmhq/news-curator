FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install dependencies (cached layer)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY . .

# Data directory
RUN mkdir -p /data/curations

EXPOSE 8080

CMD ["bun", "run", "server.ts"]
