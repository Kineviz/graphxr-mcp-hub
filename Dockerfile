# Multi-stage Dockerfile for GraphXR MCP Server
# ── Build stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY graphxr_mcp_server ./graphxr_mcp_server
COPY semantic_layer ./semantic_layer
COPY mcp_client ./mcp_client

RUN npm install --save-dev typescript
RUN npx tsc

# ── Runtime stage ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY config ./config
COPY data ./data

EXPOSE 8899

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:8899/health || exit 1

CMD ["node", "dist/graphxr_mcp_server/index.js"]
