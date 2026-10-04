# syntax=docker/dockerfile:1
FROM node:26-bookworm-slim AS base

# Install security updates
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    KEYRING_BACKEND=file

# Create data directory with proper ownership for non-root node user
RUN mkdir -p /home/node/.config/friends && chown -R node:node /home/node/.config

# Copy dependency manifests first for optimal layer caching
COPY package.json package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source
COPY server/ ./server/
COPY src/ ./src/

# Ensure files belong to node user
RUN chown -R node:node /app

# Switch to non-root user for security
USER node

# Persistent storage volume
VOLUME ["/home/node/.config/friends"]

EXPOSE 3000

# Self-contained healthcheck using Node runtime (no external curl/wget dependency needed)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "http.get('http://127.0.0.1:3000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server/server.js"]
