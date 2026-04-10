FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install dependencies (cached layer)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY . .

# Data directory — owned by the non-root bun user
RUN mkdir -p /data/curations && chown -R bun:bun /data /app

USER bun

EXPOSE 8391

CMD ["bun", "run", "server.ts"]
