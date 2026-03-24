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
 *
 * Web Admin UI:
 *   GET http://localhost:8899/admin         → management dashboard
 *   GET http://localhost:8899/admin/config  → current hub config (JSON)
 *   PATCH http://localhost:8899/admin/config → toggle a server on/off
 *   GET http://localhost:8899/admin/streams → active stream subscriptions
 */

import express from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
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
import { streamSubscribe } from './tools/stream_subscribe.js';
import { streamUnsubscribe, streamList } from './tools/stream_tools.js';
import { ALL_TOOL_DEFINITIONS } from './tools/definitions.js';
import { StreamManager } from '../streaming/stream_manager.js';

dotenv.config();

const PORT = parseInt(process.env.GRAPHXR_MCP_PORT ?? '8899', 10);
const GRAPHXR_WS_URL = process.env.GRAPHXR_WS_URL ?? 'ws://localhost:8080';
const SERVER_NAME = 'graphxr-mcp-server';
const SERVER_VERSION = '1.0.0';

const HUB_CONFIG_PATH = path.resolve(process.cwd(), 'config', 'hub_config.yaml');

// ---------------------------------------------------------------------------
// Shared GraphXR WebGL bridge (WebSocket connection to GraphXR web app)
// ---------------------------------------------------------------------------
const graphxrClient = new GraphXRClient(GRAPHXR_WS_URL);

// ---------------------------------------------------------------------------
// Shared stream manager
// ---------------------------------------------------------------------------
const streamManager = new StreamManager(graphxrClient);

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
      case 'stream_subscribe':
        return streamSubscribe(streamManager, args as Record<string, unknown>);
      case 'stream_unsubscribe':
        return streamUnsubscribe(streamManager, args as Record<string, unknown>);
      case 'stream_list':
        return streamList(streamManager);
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
        streaming: true,
      },
      // Signals that this server can integrate with GraphXR WebGL
      graphxrCompatible: true,
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
    await server.connect(transport);

    // Register this transport so POST /messages can route to it
    sseTransports.set(transport.sessionId, transport);

    // Clean up when the client disconnects
    req.on('close', () => {
      sseTransports.delete(transport.sessionId);
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
    await transport.handlePostMessage(req, res);
  });

  // ── Web Admin UI ──────────────────────────────────────────────────────────
  mountAdminRoutes(app);

  app.listen(PORT, () => {
    console.log(`[graphxr-mcp] HTTP/SSE server listening on http://localhost:${PORT}`);
    console.log(`[graphxr-mcp]   Auto-discovery: GET http://localhost:${PORT}/health`);
    console.log(`[graphxr-mcp]   MCP manifest:   GET http://localhost:${PORT}/mcp-info`);
    console.log(`[graphxr-mcp]   SSE endpoint:   GET http://localhost:${PORT}/sse`);
    console.log(`[graphxr-mcp]   Admin UI:        GET http://localhost:${PORT}/admin`);
  });
}

// ---------------------------------------------------------------------------
// Admin UI — read/write hub_config.yaml, show stream subscriptions
// ---------------------------------------------------------------------------

type HubConfigShape = Record<string, unknown>;

function loadHubConfig(): HubConfigShape {
  if (!fs.existsSync(HUB_CONFIG_PATH)) return {};
  return (yaml.parse(fs.readFileSync(HUB_CONFIG_PATH, 'utf8')) as HubConfigShape) ?? {};
}

function saveHubConfig(config: HubConfigShape): void {
  fs.writeFileSync(HUB_CONFIG_PATH, yaml.stringify(config), 'utf8');
}

function mountAdminRoutes(app: express.Express): void {
  /** GET /admin/config — returns current hub config as JSON */
  app.get('/admin/config', (_req, res) => {
    res.json(loadHubConfig());
  });

  /**
   * PATCH /admin/config — toggle a server enabled/disabled.
   * Body: { "server": "duckdb", "enabled": true }
   * The "server" key supports top-level keys (duckdb, toolbox, graphxr_mcp_server)
   * and named entries in the mcp_servers array (filesystem, fetch, …).
   */
  app.patch('/admin/config', (req, res) => {
    const { server, enabled } = req.body as { server?: string; enabled?: boolean };
    if (!server || typeof enabled !== 'boolean') {
      res.status(400).json({ error: '"server" (string) and "enabled" (boolean) are required.' });
      return;
    }

    const config = loadHubConfig();

    // Try top-level keys first
    if (server in config && typeof config[server] === 'object' && config[server] !== null) {
      (config[server] as Record<string, unknown>)['enabled'] = enabled;
      saveHubConfig(config);
      res.json({ success: true, server, enabled });
      return;
    }

    // Try mcp_servers array
    const mcpServers = config['mcp_servers'];
    if (Array.isArray(mcpServers)) {
      const entry = mcpServers.find(
        (s: unknown) => typeof s === 'object' && s !== null && (s as Record<string, unknown>)['name'] === server
      ) as Record<string, unknown> | undefined;
      if (entry) {
        entry['enabled'] = enabled;
        saveHubConfig(config);
        res.json({ success: true, server, enabled });
        return;
      }
    }

    res.status(404).json({ error: `Server "${server}" not found in hub_config.yaml.` });
  });

  /** GET /admin/streams — list active stream subscriptions */
  app.get('/admin/streams', (_req, res) => {
    res.json({ subscriptions: streamManager.listSubscriptions() });
  });

  /** GET /admin — serves the HTML management dashboard */
  app.get('/admin', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buildAdminHtml(PORT, SERVER_NAME, SERVER_VERSION));
  });
}

// ---------------------------------------------------------------------------
// Admin HTML — a self-contained single-page dashboard
// ---------------------------------------------------------------------------

function buildAdminHtml(port: number, name: string, version: string): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GraphXR MCP Admin</title>
<style>
  :root { --bg:#0d1117; --card:#161b22; --border:#30363d; --text:#c9d1d9; --accent:#58a6ff; --green:#3fb950; --red:#f85149; --yellow:#d29922; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; padding: 24px; }
  h1 { color: var(--accent); font-size: 20px; margin-bottom: 4px; }
  .subtitle { color: #8b949e; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #8b949e; margin-bottom: 12px; }
  .status-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .dot.green { background: var(--green); }
  .dot.red   { background: var(--red); }
  .dot.yellow { background: var(--yellow); }
  .server-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); }
  .server-row:last-child { border-bottom: none; }
  .server-name { font-weight: 600; font-size: 13px; }
  .server-desc { color: #8b949e; font-size: 12px; margin-top: 2px; }
  .toggle { position: relative; width: 40px; height: 22px; flex-shrink: 0; cursor: pointer; }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .slider { position: absolute; inset: 0; background: #30363d; border-radius: 11px; transition: .2s; }
  .slider:before { content: ""; position: absolute; height: 16px; width: 16px; left: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: .2s; }
  input:checked + .slider { background: var(--green); }
  input:checked + .slider:before { transform: translateX(18px); }
  .tool-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .tool-badge { background: #1f2d40; border: 1px solid var(--accent); color: var(--accent); border-radius: 4px; padding: 2px 8px; font-size: 11px; font-family: monospace; }
  .stream-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .stream-table th { color: #8b949e; text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); }
  .stream-table td { padding: 6px 8px; border-bottom: 1px solid #21262d; }
  .btn { background: #21262d; border: 1px solid var(--border); color: var(--text); border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
  .btn:hover { background: #30363d; }
  #toast { position: fixed; bottom: 24px; right: 24px; background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 10px 16px; display: none; font-size: 13px; }
</style>
</head>
<body>
<h1>🕸 GraphXR MCP Admin</h1>
<p class="subtitle">${name} v${version} — http://localhost:${port}</p>

<div class="grid" id="status-grid">
  <div class="card">
    <h2>Server Status</h2>
    <div class="status-row"><span class="dot green"></span><strong>MCP Server</strong>&nbsp;running on :${port}</div>
    <div class="status-row"><span class="dot" id="ws-dot" style="background:var(--yellow)"></span><span id="ws-status">GraphXR WebSocket: checking…</span></div>
    <div style="margin-top:10px;font-size:12px;color:#8b949e">
      <a style="color:var(--accent)" href="/health" target="_blank">/health</a> &nbsp;
      <a style="color:var(--accent)" href="/mcp-info" target="_blank">/mcp-info</a> &nbsp;
      <a style="color:var(--accent)" href="/sse" target="_blank">/sse</a>
    </div>
  </div>
  <div class="card">
    <h2>Available Tools (${ALL_TOOL_DEFINITIONS.length})</h2>
    <div class="tool-list" id="tool-list">Loading…</div>
  </div>
</div>

<div class="grid">
  <div class="card" id="config-card">
    <h2>Data Sources &nbsp;<button class="btn" onclick="reloadConfig()">↻ Refresh</button></h2>
    <div id="server-list">Loading…</div>
  </div>
  <div class="card">
    <h2>Active Streams &nbsp;<button class="btn" onclick="reloadStreams()">↻ Refresh</button></h2>
    <div id="stream-list">Loading…</div>
  </div>
</div>

<div id="toast"></div>

<script>
const ALL_TOOLS = ${JSON.stringify(ALL_TOOL_DEFINITIONS.map((t) => t.name))};

// ── Tool list
document.getElementById('tool-list').innerHTML = ALL_TOOLS.map(n =>
  '<span class="tool-badge">' + n + '</span>'
).join('');

// ── Config (data sources)
async function reloadConfig() {
  const res = await fetch('/admin/config');
  const cfg = await res.json();
  renderConfig(cfg);
}

function renderConfig(cfg) {
  let html = '';
  const toplevel = ['graphxr_mcp_server', 'duckdb', 'toolbox'];
  for (const key of toplevel) {
    const val = cfg[key];
    if (!val) continue;
    const enabled = !!val.enabled;
    const desc = val.description || val.graphxr_ws_url || val.url || '';
    html += serverRow(key, key, desc, enabled);
  }
  const servers = cfg.mcp_servers || [];
  for (const s of servers) {
    html += serverRow(s.name, s.name, s.description || '', !!s.enabled);
  }
  document.getElementById('server-list').innerHTML = html || '<em style="color:#8b949e">No servers configured.</em>';
}

function serverRow(key, label, desc, enabled) {
  return '<div class="server-row">' +
    '<div><div class="server-name">' + label + '</div>' +
    (desc ? '<div class="server-desc">' + desc + '</div>' : '') + '</div>' +
    '<label class="toggle">' +
      '<input type="checkbox" ' + (enabled ? 'checked' : '') + ' onchange="toggleServer(' + JSON.stringify(key) + ', this.checked)">' +
      '<span class="slider"></span>' +
    '</label>' +
  '</div>';
}

async function toggleServer(server, enabled) {
  const res = await fetch('/admin/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ server, enabled }),
  });
  const data = await res.json();
  showToast(data.success ? '✓ ' + server + ' ' + (enabled ? 'enabled' : 'disabled') : '✗ ' + (data.error || 'Error'));
}

// ── Streams
async function reloadStreams() {
  const res = await fetch('/admin/streams');
  const { subscriptions } = await res.json();
  if (!subscriptions.length) {
    document.getElementById('stream-list').innerHTML = '<em style="color:#8b949e">No active streams.</em>';
    return;
  }
  let html = '<table class="stream-table"><thead><tr><th>ID</th><th>Status</th><th>Msgs</th><th>Mode</th><th></th></tr></thead><tbody>';
  for (const s of subscriptions) {
    const color = s.status === 'connected' ? 'var(--green)' : s.status === 'error' ? 'var(--red)' : 'var(--yellow)';
    html += '<tr><td><code>' + s.id + '</code></td>' +
      '<td><span style="color:' + color + '">' + s.status + '</span></td>' +
      '<td>' + s.messageCount + '</td>' +
      '<td>' + s.mode + '</td>' +
      '<td><button class="btn" onclick="stopStream(' + JSON.stringify(s.id) + ')">Stop</button></td></tr>';
  }
  html += '</tbody></table>';
  document.getElementById('stream-list').innerHTML = html;
}

async function stopStream(id) {
  // To stop a stream, use the stream_unsubscribe MCP tool via the SSE session.
  // Displaying the ID here lets the user issue the tool call from the connected LLM client.
  showToast('Use stream_unsubscribe MCP tool with id: ' + id);
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 3000);
}

// Initial load
reloadConfig();
reloadStreams();
</script>
</body>
</html>`;
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

