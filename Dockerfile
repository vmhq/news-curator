FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install dependencies (cached layer)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY . .

# su-exec is used by the entrypoint to drop privileges after fixing volume ownership
RUN apk add --no-cache su-exec

# Data directory — pre-create with correct ownership for when no volume is mounted
RUN mkdir -p /data/curations && chown -R bun:bun /data /app

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8391

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "run", "server.ts"]
