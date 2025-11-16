# Use Node.js 20 LTS
FROM node:20-alpine AS base

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production image
FROM node:20-alpine AS production

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application
COPY --from=base /app/dist ./dist
COPY --from=base /app/fixtures ./fixtures

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S sentinel -u 1001

# Change ownership of the app directory
RUN chown -R sentinel:nodejs /app
USER sentinel

# Expose port
EXPOSE 3001
EXPOSE 9090

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node ./dist/scripts/healthcheck.js

# Start the application
CMD ["node", "dist/index.js"]