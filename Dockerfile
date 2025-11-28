# Revamp - Legacy Browser Compatibility Proxy
# Multi-stage build for optimal image size

# Build stage
FROM node:25-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9.15.9

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN pnpm build

# Production stage
FROM node:25-alpine AS production

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9.15.9

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files
COPY --from=builder /app/dist ./dist

# Create directories for certs and cache
RUN mkdir -p .revamp-certs .revamp-cache

# Expose ports
# SOCKS5 proxy
EXPOSE 1080
# HTTP proxy
EXPOSE 8080
# Captive portal (certificate download)
EXPOSE 8888

# Set environment variables
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8888/ || exit 1

# Run the application
CMD ["node", "dist/index.js"]
