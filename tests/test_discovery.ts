/**
 * Tests for the auto-discovery client (mcp_client/discovery.ts).
 *
 * Since GraphXRMcpDiscovery uses the browser Fetch API and EventSource,
 * we test it in a Node environment with minimal mocking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphXRMcpDiscovery, DiscoveryStatus } from '../mcp_client/discovery.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const MOCK_HEALTH = { status: 'ok', service: 'graphxr-mcp-server', version: '1.0.0' };
const MOCK_MCP_INFO = {
  name: 'graphxr-mcp-server',
  version: '1.0.0',
  protocol: 'mcp',
  transport: ['sse', 'stdio'],
  sseEndpoint: '/sse',
  tools: [{ name: 'push_graph', description: 'Push graph data.' }],
  capabilities: { pushGraph: true, queryGraph: true, bidirectional: true },
  graphxrCompatible: true,
};

function mockFetchSuccess() {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes('/health')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_HEALTH) });
    }
    if (url.includes('/mcp-info')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_MCP_INFO) });
    }
    return Promise.resolve({ ok: false });
  }) as unknown as typeof fetch;
}

function mockFetchFailure() {
  global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
}

function mockFetchHealthOkInfoNotCompatible() {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes('/health')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_HEALTH) });
    }
    if (url.includes('/mcp-info')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ...MOCK_MCP_INFO, graphxrCompatible: false }),
      });
    }
    return Promise.resolve({ ok: false });
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphXRMcpDiscovery — initial state', () => {
  it('starts with idle status', () => {
    const d = new GraphXRMcpDiscovery();
    expect(d.getStatus()).toBe('idle');
    expect(d.getServerInfo()).toBeNull();
  });
});

describe('GraphXRMcpDiscovery — probe success', () => {
  beforeEach(mockFetchSuccess);

  it('transitions to "available" when server is found and compatible', async () => {
    const d = new GraphXRMcpDiscovery({ port: 8899 });
    const statuses: DiscoveryStatus[] = [];
    d.onStatusChange((s) => statuses.push(s));

    await d['probe']();

    expect(statuses).toContain('available');
    expect(d.getStatus()).toBe('available');
  });

  it('populates serverInfo after a successful probe', async () => {
    const d = new GraphXRMcpDiscovery();
    await d['probe']();

    const info = d.getServerInfo();
    expect(info).not.toBeNull();
    expect(info?.graphxrCompatible).toBe(true);
    expect(info?.tools).toHaveLength(1);
    expect(info?.tools[0].name).toBe('push_graph');
  });
});

describe('GraphXRMcpDiscovery — probe failure', () => {
  beforeEach(mockFetchFailure);

  it('transitions to "unavailable" when server is not running', async () => {
    const d = new GraphXRMcpDiscovery();
    await d['probe']();
    expect(d.getStatus()).toBe('unavailable');
    expect(d.getServerInfo()).toBeNull();
  });
});

describe('GraphXRMcpDiscovery — non-graphxr server', () => {
  beforeEach(mockFetchHealthOkInfoNotCompatible);

  it('sets unavailable when server is not graphxrCompatible', async () => {
    const d = new GraphXRMcpDiscovery();
    await d['probe']();
    expect(d.getStatus()).toBe('unavailable');
  });
});

describe('GraphXRMcpDiscovery — status change handler', () => {
  beforeEach(mockFetchSuccess);

  it('fires handler on status change', async () => {
    const d = new GraphXRMcpDiscovery();
    const calls: [DiscoveryStatus, unknown][] = [];
    d.onStatusChange((s, info) => calls.push([s, info]));
    await d['probe']();

    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBe('available');
  });

  it('returns an unsubscribe function that stops further calls', async () => {
    const d = new GraphXRMcpDiscovery();
    const calls: DiscoveryStatus[] = [];
    const unsubscribe = d.onStatusChange((s) => calls.push(s));

    await d['probe'](); // probing → available
    const countAfterFirst = calls.length;

    unsubscribe();
    await d['probe'](); // should fire again but handler removed
    expect(calls.length).toBe(countAfterFirst);
  });
});

describe('GraphXRMcpDiscovery — connect guard', () => {
  it('throws if connect() called before server is discovered', () => {
    const d = new GraphXRMcpDiscovery();
    expect(() => d.connect()).toThrow('[discovery] Cannot connect');
  });
});
