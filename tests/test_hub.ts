/**
 * Tests for the MCP Hub client (mcp_client/hub.ts).
 * Uses a temporary config file to avoid depending on the real hub_config.yaml.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { McpHub } from '../mcp_client/hub.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeTempConfig(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphxr-hub-test-'));
  const file = path.join(dir, 'hub_config.yaml');
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McpHub — config loading', () => {
  it('returns empty config when file does not exist', () => {
    const hub = new McpHub('/tmp/nonexistent-hub-config.yaml');
    hub['config'] = hub['loadConfig']();
    expect(hub.getConfig()).toEqual({});
  });

  it('parses graphxr_mcp_server section', () => {
    const configFile = writeTempConfig(`
graphxr_mcp_server:
  enabled: true
  port: 8899
  graphxr_ws_url: ws://localhost:8080
`);
    const hub = new McpHub(configFile);
    hub['config'] = hub['loadConfig']();
    expect(hub.getConfig().graphxr_mcp_server?.port).toBe(8899);
    expect(hub.getConfig().graphxr_mcp_server?.graphxr_ws_url).toBe('ws://localhost:8080');
  });

  it('parses duckdb section', () => {
    const configFile = writeTempConfig(`
duckdb:
  enabled: true
  transport: stdio
  command: uvx
  args:
    - mcp-server-duckdb
    - --db-path
    - ":memory:"
`);
    const hub = new McpHub(configFile);
    hub['config'] = hub['loadConfig']();
    const duckdb = hub.getConfig().duckdb;
    expect(duckdb?.enabled).toBe(true);
    expect(duckdb?.transport).toBe('stdio');
    expect(duckdb?.command).toBe('uvx');
  });

  it('parses toolbox SSE section', () => {
    const configFile = writeTempConfig(`
toolbox:
  enabled: true
  transport: sse
  url: http://localhost:5000/sse
`);
    const hub = new McpHub(configFile);
    hub['config'] = hub['loadConfig']();
    expect(hub.getConfig().toolbox?.url).toBe('http://localhost:5000/sse');
  });

  it('parses mcp_servers list', () => {
    const configFile = writeTempConfig(`
mcp_servers:
  - name: filesystem
    enabled: true
    transport: stdio
    command: npx
    args:
      - "-y"
      - "@modelcontextprotocol/server-filesystem"
      - ./data
  - name: fetch
    enabled: false
    transport: stdio
    command: npx
    args:
      - "-y"
      - "@modelcontextprotocol/server-fetch"
`);
    const hub = new McpHub(configFile);
    hub['config'] = hub['loadConfig']();
    const servers = hub.getConfig().mcp_servers ?? [];
    expect(servers).toHaveLength(2);
    expect(servers[0].name).toBe('filesystem');
    expect(servers[0].enabled).toBe(true);
    expect(servers[1].name).toBe('fetch');
    expect(servers[1].enabled).toBe(false);
  });
});

describe('McpHub — server registry', () => {
  let hub: McpHub;
  let configFile: string;

  beforeEach(() => {
    configFile = writeTempConfig(`
toolbox:
  enabled: true
  transport: sse
  url: http://localhost:5000/sse
mcp_servers:
  - name: fetch
    enabled: true
    transport: sse
    url: http://localhost:6000/sse
  - name: filesystem
    enabled: false
    transport: stdio
    command: npx
    args: []
`);
    hub = new McpHub(configFile);
    hub['config'] = hub['loadConfig']();
  });

  it('listServers includes enabled SSE servers', () => {
    const servers = hub.listServers();
    expect(servers).toContain('toolbox');
    expect(servers).toContain('fetch');
  });

  it('listServers excludes disabled servers', () => {
    const servers = hub.listServers();
    expect(servers).not.toContain('filesystem');
  });

  it('hasServer returns true for an enabled SSE server', () => {
    expect(hub.hasServer('toolbox')).toBe(true);
    expect(hub.hasServer('fetch')).toBe(true);
  });

  it('hasServer returns false for unknown server', () => {
    expect(hub.hasServer('nonexistent')).toBe(false);
  });

  it('getSseUrl returns the correct URL for toolbox', () => {
    expect(hub.getSseUrl('toolbox')).toBe('http://localhost:5000/sse');
  });

  it('getSseUrl returns the correct URL for a named SSE server', () => {
    expect(hub.getSseUrl('fetch')).toBe('http://localhost:6000/sse');
  });

  it('getSseUrl returns null for disabled server', () => {
    expect(hub.getSseUrl('filesystem')).toBeNull();
  });
});

describe('McpHub — lifecycle (no real processes)', () => {
  it('starts and stops without error when no stdio servers are enabled', async () => {
    const configFile = writeTempConfig(`
toolbox:
  enabled: true
  transport: sse
  url: http://localhost:5000/sse
`);
    const hub = new McpHub(configFile);
    await hub.start();
    expect(hub.listServers()).toContain('toolbox');
    await hub.stop();
  });

  it('listAllTools returns empty array when no stdio servers are running', async () => {
    const hub = new McpHub('/tmp/nonexistent.yaml');
    await hub.start();
    expect(hub.listAllTools()).toEqual([]);
    await hub.stop();
  });

  it('calling start twice is idempotent', async () => {
    const hub = new McpHub('/tmp/nonexistent.yaml');
    await hub.start();
    await hub.start(); // should not throw
    await hub.stop();
  });
});
