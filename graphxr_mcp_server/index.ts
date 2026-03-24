/**
 * GraphXR MCP Server — Main Entry Point
 *
 * Runs on localhost:8899 by default.
 * Supports SSE (HTTP) and STDIO transports so that:
 *   - GraphXR Agent chat page can auto-discover and optionally connect
 *   - Claude Desktop, Codex, and other MCP clients can optionally connect
 *   - Data can be pushed TO GraphXR WebGL or pulled FROM it
 *
 * Auto-discovery:
 *   GET http://localhost:8899/health   → liveness probe
 *   GET http://localhost:8899/mcp-info → MCP identity + capabilities manifest
 */

import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as dotenv from 'dotenv';

import { GraphXRClient } from './graphxr_client.js';
import { pushGraph } from './tools/push_graph.js';
import { getGraphState } from './tools/get_graph_state.js';
import { getNodes } from './tools/get_nodes.js';
import { getEdges } from './tools/get_edges.js';
import { addNodes } from './tools/add_nodes.js';
import { addEdges } from './tools/add_edges.js';
import { updateNode } from './tools/update_node.js';
import { findNeighbors } from './tools/find_neighbors.js';
import { clearGraph } from './tools/clear_graph.js';
import { ALL_TOOL_DEFINITIONS } from './tools/definitions.js';

dotenv.config();

const PORT = parseInt(process.env.GRAPHXR_MCP_PORT ?? '8899', 10);
const GRAPHXR_WS_URL = process.env.GRAPHXR_WS_URL ?? 'ws://localhost:8080';
const SERVER_NAME = 'graphxr-mcp-server';
const SERVER_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Shared GraphXR WebGL bridge (WebSocket connection to GraphXR web app)
// ---------------------------------------------------------------------------
const graphxrClient = new GraphXRClient(GRAPHXR_WS_URL);

// ---------------------------------------------------------------------------
// MCP Server factory — creates a configured MCP Server instance
// ---------------------------------------------------------------------------
function createMcpServer(): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOL_DEFINITIONS,
  }));

  // Dispatch tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    switch (name) {
      case 'push_graph':
        return pushGraph(graphxrClient, args);
      case 'get_graph_state':
        return getGraphState(graphxrClient, args);
      case 'get_nodes':
        return getNodes(graphxrClient, args);
      case 'get_edges':
        return getEdges(graphxrClient, args);
      case 'add_nodes':
        return addNodes(graphxrClient, args);
      case 'add_edges':
        return addEdges(graphxrClient, args);
      case 'update_node':
        return updateNode(graphxrClient, args);
      case 'find_neighbors':
        return findNeighbors(graphxrClient, args);
      case 'clear_graph':
        return clearGraph(graphxrClient, args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// STDIO mode — for Claude Desktop / Codex CLI and similar clients
// ---------------------------------------------------------------------------
async function startStdioMode(): Promise<void> {
  console.error(`[graphxr-mcp] Starting in STDIO mode (${SERVER_NAME} v${SERVER_VERSION})`);
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ---------------------------------------------------------------------------
// SSE (HTTP) mode — for GraphXR Agent chat page auto-discovery
// ---------------------------------------------------------------------------
async function startHttpMode(): Promise<void> {
  const app = express();

  // Allow cross-origin requests from the GraphXR web app
  app.use(cors({ origin: '*' }));
  app.use(express.json());

  // ── Auto-discovery endpoints ──────────────────────────────────────────────

  /**
   * Liveness probe.
   * GraphXR Agent polls this to check if the MCP server is running.
   */
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: SERVER_NAME, version: SERVER_VERSION });
  });

  /**
   * MCP identity and capability manifest.
   * GraphXR Agent fetches this to confirm the service is a compatible
   * GraphXR MCP Server and to learn what tools are available.
   */
  app.get('/mcp-info', (_req, res) => {
    res.json({
      name: SERVER_NAME,
      version: SERVER_VERSION,
      protocol: 'mcp',
      transport: ['sse', 'stdio'],
      sseEndpoint: '/sse',
      tools: ALL_TOOL_DEFINITIONS.map((t) => ({
        name: t.name,
        description: t.description,
      })),
      capabilities: {
        pushGraph: true,
        queryGraph: true,
        bidirectional: true,
      },
      // Signals that this server can integrate with GraphXR WebGL
      graphxrCompatible: true,
    });
  });

  // ── SSE MCP transport ─────────────────────────────────────────────────────
  // Each GET /sse request creates a dedicated MCP Server + transport pair so
  // that multiple clients (GraphXR Agent, Claude, Codex…) can connect
  // independently and concurrently.
  app.get('/sse', async (req, res) => {
    const server = createMcpServer();
    const transport = new SSEServerTransport('/messages', res);
    await server.connect(transport);

    // Clean up when the client disconnects
    req.on('close', () => {
      server.close().catch(() => {});
    });
  });

  // POST /messages — SSE response channel (required by MCP SSE transport)
  const sseTransports = new Map<string, SSEServerTransport>();
  app.post('/messages', async (req, res) => {
    const sessionId = req.query['sessionId'] as string;
    const transport = sseTransports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  app.listen(PORT, () => {
    console.log(`[graphxr-mcp] HTTP/SSE server listening on http://localhost:${PORT}`);
    console.log(`[graphxr-mcp]   Auto-discovery: GET http://localhost:${PORT}/health`);
    console.log(`[graphxr-mcp]   MCP manifest:   GET http://localhost:${PORT}/mcp-info`);
    console.log(`[graphxr-mcp]   SSE endpoint:   GET http://localhost:${PORT}/sse`);
  });
}

// ---------------------------------------------------------------------------
// Entry point — detect transport mode from CLI args or env
// ---------------------------------------------------------------------------
const mode = process.argv.includes('--stdio') || process.env.MCP_TRANSPORT === 'stdio'
  ? 'stdio'
  : 'http';

if (mode === 'stdio') {
  startStdioMode().catch((err) => {
    console.error('[graphxr-mcp] Fatal error (stdio mode):', err);
    process.exit(1);
  });
} else {
  startHttpMode().catch((err) => {
    console.error('[graphxr-mcp] Fatal error (http mode):', err);
    process.exit(1);
  });
}
