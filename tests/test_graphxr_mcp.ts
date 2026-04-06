/**
 * Tests for GraphXR MCP Server auto-discovery endpoints.
 * Uses a lightweight HTTP client (no external dependencies beyond Node built-ins).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';

const PORT = 18899; // Distinct test port

function get(path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: data });
        }
      });
    });
    req.on('error', reject);
  });
}

// We spin up a minimal Express app that mirrors the real server's
// discovery endpoints, so we can test them without a full MCP server.
import express from 'express';
import cors from 'cors';

const TOOL_STUB = [
  { name: 'push_graph', description: 'Push graph to GraphXR.' },
  { name: 'get_graph_state', description: 'Get graph state.' },
];

let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(cors({ origin: '*' }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'graphxr-mcp-server', version: '0.1.0' });
  });

  app.get('/mcp-info', (_req, res) => {
    res.json({
      name: 'graphxr-mcp-server',
      version: '0.1.0',
      protocol: 'mcp',
      transport: ['sse', 'stdio'],
      sseEndpoint: '/sse',
      tools: TOOL_STUB,
      capabilities: { pushGraph: true, queryGraph: true, bidirectional: true },
      graphxrCompatible: true,
    });
  });

  await new Promise<void>((resolve) => {
    server = app.listen(PORT, resolve);
  });
});

afterAll(() => {
  server?.close();
});

describe('Auto-discovery: /health', () => {
  it('returns 200 with service info', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).status).toBe('ok');
    expect((res.body as Record<string, unknown>).service).toBe('graphxr-mcp-server');
  });
});

describe('Auto-discovery: /mcp-info', () => {
  it('returns 200 with MCP manifest', async () => {
    const res = await get('/mcp-info');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.protocol).toBe('mcp');
    expect(body.graphxrCompatible).toBe(true);
  });

  it('manifest includes bidirectional capabilities', async () => {
    const res = await get('/mcp-info');
    const caps = (res.body as Record<string, unknown>).capabilities as Record<string, boolean>;
    expect(caps.pushGraph).toBe(true);
    expect(caps.queryGraph).toBe(true);
    expect(caps.bidirectional).toBe(true);
  });

  it('manifest lists available tools', async () => {
    const res = await get('/mcp-info');
    const tools = (res.body as Record<string, unknown>).tools as unknown[];
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it('manifest exposes SSE endpoint path', async () => {
    const res = await get('/mcp-info');
    expect((res.body as Record<string, unknown>).sseEndpoint).toBe('/sse');
  });
});
