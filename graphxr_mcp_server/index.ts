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
import { resolve } from 'path';

import { GraphXRBridge } from './graphxr_bridge';
import { randomUUID } from 'crypto';

import { pushGraph } from './tools/push_graph';
import { getGraphState } from './tools/get_graph_state';
import { getNodes } from './tools/get_nodes';
import { getEdges } from './tools/get_edges';
import { addNodes } from './tools/add_nodes';
import { addEdges } from './tools/add_edges';
import { updateNode } from './tools/update_node';
import { findNeighbors } from './tools/find_neighbors';
import { clearGraph } from './tools/clear_graph';
import { ALL_TOOL_DEFINITIONS } from './tools/definitions';
import { LineageTracker } from '../semantic_layer/lineage';
import { SessionManager } from './session_manager';
import { createAdminRouter } from './admin_ui';
import { DuckDBManager } from './duckdb_manager';
import { ingestFile } from './tools/ingest_file';
import { queryData } from './tools/query_data';
import { listTables } from './tools/list_tables';
import { SourceManager } from './source_manager';
import { connectSource } from './tools/connect_source';

dotenv.config();

const PORT = parseInt(process.env.GRAPHXR_MCP_PORT ?? '8899', 10);
const SERVER_NAME = 'graphxr-mcp-server';
const SERVER_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Shared instances
// ---------------------------------------------------------------------------
const graphxrBridge = new GraphXRBridge({ requestTimeoutMs: 15_000 });
const lineageTracker = new LineageTracker();
const sessionManager = new SessionManager();
const duckdbManager = new DuckDBManager();
const sourceManager = new SourceManager();

// ---------------------------------------------------------------------------
// MCP Server factory — creates a configured MCP Server instance
// ---------------------------------------------------------------------------
function createMcpServer(): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  // List available tools (built-in + proxied from external sources)
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...ALL_TOOL_DEFINITIONS, ...sourceManager.getProxiedTools()],
  }));

  // Dispatch tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Built-in tools
    switch (name) {
      case 'push_graph':
        return pushGraph(graphxrBridge, args, lineageTracker);
      case 'get_graph_state':
        return getGraphState(graphxrBridge, args);
      case 'get_nodes':
        return getNodes(graphxrBridge, args);
      case 'get_edges':
        return getEdges(graphxrBridge, args);
      case 'add_nodes':
        return addNodes(graphxrBridge, args, lineageTracker);
      case 'add_edges':
        return addEdges(graphxrBridge, args, lineageTracker);
      case 'update_node':
        return updateNode(graphxrBridge, args);
      case 'find_neighbors':
        return findNeighbors(graphxrBridge, args);
      case 'clear_graph':
        return clearGraph(graphxrBridge, args);
      case 'ingest_file':
        return ingestFile(duckdbManager, args);
      case 'query_data':
        return queryData(duckdbManager, graphxrBridge, args, lineageTracker);
      case 'list_tables':
        return listTables(duckdbManager);
      case 'connect_source':
        return connectSource(sourceManager, args);
    }

    // Proxied tools from external MCP servers (namespaced: "toolbox__neo4j-query")
    if (name.includes('__')) {
      const result = await sourceManager.dispatchTool(name, (args ?? {}) as Record<string, unknown>);
      if (result !== null) return result as { content: Array<{ type: 'text'; text: string }> };
    }

    throw new Error(`Unknown tool: ${name}`);
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
  // Parse JSON for all routes EXCEPT /messages (MCP SDK needs the raw stream)
  app.use((req, res, next) => {
    if (req.path === '/messages') return next();
    express.json()(req, res, next);
  });

  // ── Smart root route ─────────────────────────────────────────────────────
  // Browser (Accept: text/html) → redirect to admin dashboard
  // Agent / API client → return JSON with server info + endpoint directory
  app.get('/', (req, res) => {
    const accept = req.headers.accept || '';
    if (accept.includes('text/html')) {
      return res.redirect('/admin');
    }
    res.json({
      service: SERVER_NAME,
      version: SERVER_VERSION,
      status: 'ok',
      endpoints: {
        admin: '/admin',
        health: '/health',
        mcpInfo: '/mcp-info',
        sse: '/sse',
        sources: '/sources',
        sessions: '/sessions',
        graphxrEvents: '/graphxr/events',
        graphxrResults: '/graphxr/results',
        graphxrStatus: '/graphxr/status',
        examples: '/examples/',
      },
    });
  });

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
      // GraphXR bridge connection info — GraphXR connects here
      graphxrBridge: {
        eventsEndpoint: '/graphxr/events',
        resultsEndpoint: '/graphxr/results',
        statusEndpoint: '/graphxr/status',
        protocol: 'sse+rest',
        description: 'Connect via SSE to receive commands, POST results back',
      },
    });
  });

  // ── GraphXR Bridge endpoints ──────────────────────────────────────────────
  // GraphXR discovers the Hub, then connects via SSE to receive commands.
  // Results are POSTed back to /graphxr/results.

  app.get('/graphxr/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.flushHeaders();

    const connectionId = randomUUID();
    graphxrBridge.addConnection(connectionId, res, {
      userAgent: req.headers['user-agent'],
    });

    req.on('close', () => {
      graphxrBridge.removeConnection(connectionId);
    });
  });

  app.post('/graphxr/results', (req, res) => {
    const { requestId, result, error } = req.body;
    if (!requestId) {
      res.status(400).json({ error: 'Missing requestId' });
      return;
    }
    const handled = graphxrBridge.handleResult(requestId, result, error ?? undefined);
    if (handled) {
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: 'Unknown or expired requestId' });
    }
  });

  app.get('/graphxr/status', (_req, res) => {
    res.json({
      connectedInstances: graphxrBridge.connectedCount,
      pendingRequests: graphxrBridge.pendingCount,
      connections: graphxrBridge.listConnections(),
    });
  });

  // ── SSE MCP transport ─────────────────────────────────────────────────────
  // Each GET /sse request creates a dedicated MCP Server + transport pair so
  // that multiple clients (GraphXR Agent, Claude, Codex…) can connect
  // independently and concurrently.
  const sseTransports = new Map<string, SSEServerTransport>();

  app.get('/sse', async (req, res) => {
    const server = createMcpServer();
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;

    // Register session for multi-client collaboration
    sseTransports.set(sessionId, transport);
    sessionManager.register(sessionId, transport, req.headers['user-agent']);

    await server.connect(transport);

    // Clean up when the client disconnects
    req.on('close', () => {
      sseTransports.delete(sessionId);
      sessionManager.unregister(sessionId);
      server.close().catch(() => {});
    });
  });

  // POST /messages — SSE response channel (required by MCP SSE transport)
  app.post('/messages', async (req, res) => {
    const sessionId = req.query['sessionId'] as string;
    const transport = sseTransports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    sessionManager.touch(sessionId);
    await transport.handlePostMessage(req, res);
  });

  // ── Data sources endpoint ────────────────────────────────────────────────
  app.get('/sources', (_req, res) => {
    res.json({ sources: sourceManager.getStatus() });
  });

  // Connect an on-demand source
  app.post('/sources/:name/connect', async (req, res) => {
    const { name } = req.params;
    const connected = await sourceManager.connectByName(name);
    res.json({ name, connected, sources: sourceManager.getStatus() });
  });

  // ── Multi-client collaboration endpoint ─────────────────────────────────
  app.get('/sessions', (_req, res) => {
    res.json({
      activeSessions: sessionManager.count,
      sessions: sessionManager.listSessions(),
    });
  });

  // ── Examples (auto-generated index + static files) ─────────────────────
  const examplesDir = resolve(__dirname, '..', 'examples');
  app.get('/examples', (_req, res) => {
    const { readdirSync } = require('fs') as typeof import('fs');
    try {
      const files = readdirSync(examplesDir, { withFileTypes: true })
        .filter((f: any) => f.isFile())
        .map((f: any) => f.name);
      const list = files.map((f: string) => `<li><a href="/examples/${f}">${f}</a></li>`).join('\n');
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Examples</title>
<style>body{font-family:system-ui;background:#0d1117;color:#e6edf3;padding:32px}
a{color:#58a6ff;text-decoration:none}a:hover{text-decoration:underline}
li{margin:8px 0;font-size:1.1rem}</style></head>
<body><h1>Examples</h1><ul>${list}</ul>
<p style="margin-top:24px;color:#8b949e"><a href="/admin">&larr; Admin</a></p></body></html>`);
    } catch {
      res.status(404).send('Examples directory not found');
    }
  });
  app.use('/examples', express.static(examplesDir));

  // ── Web Admin UI ────────────────────────────────────────────────────────
  app.use('/admin', createAdminRouter(sessionManager, lineageTracker, sourceManager, graphxrBridge));

  // ── Initialize external data sources from config ─────────────────────────
  sourceManager.initialize().then(() => {
    const sources = sourceManager.getStatus();
    const connected = sources.filter((s) => s.status === 'connected');
    if (connected.length > 0) {
      console.log(`[graphxr-mcp] External sources: ${connected.map((s) => `${s.name} (${s.tools.length} tools)`).join(', ')}`);
    }
  }).catch(() => { /* non-fatal */ });

  app.listen(PORT, () => {
    console.log(`[graphxr-mcp] HTTP/SSE server listening on http://localhost:${PORT}`);
    console.log(`[graphxr-mcp]   Auto-discovery: GET http://localhost:${PORT}/health`);
    console.log(`[graphxr-mcp]   MCP manifest:   GET http://localhost:${PORT}/mcp-info`);
    console.log(`[graphxr-mcp]   SSE endpoint:   GET http://localhost:${PORT}/sse`);
    console.log(`[graphxr-mcp]   Admin UI:       GET http://localhost:${PORT}/admin`);
    console.log(`[graphxr-mcp]   GraphXR bridge: GET http://localhost:${PORT}/graphxr/events`);
    console.log(`[graphxr-mcp]   Examples:       GET http://localhost:${PORT}/examples/`);
    console.log(`[graphxr-mcp]   Sources:        GET http://localhost:${PORT}/sources`);
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
