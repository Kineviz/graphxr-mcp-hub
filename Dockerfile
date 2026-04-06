# Stage 1: Build
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY graphxr_mcp_server/ ./graphxr_mcp_server/
COPY semantic_layer/ ./semantic_layer/
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist/ ./dist/
COPY config/ ./config/
COPY data/ ./data/
COPY .env.example ./.env.example

ENV GRAPHXR_MCP_PORT=8899
ENV GRAPHXR_WS_URL=ws://host.docker.internal:8080
ENV MCP_TRANSPORT=http

EXPOSE 8899

CMD ["node", "dist/graphxr_mcp_server/index.js"]

LABEL maintainer="Kineviz"
LABEL description="GraphXR MCP Hub - Multi-source data integration for GraphXR"
LABEL version="0.1.0"
