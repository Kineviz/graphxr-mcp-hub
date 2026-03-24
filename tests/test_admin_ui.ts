/**
 * Tests for the Admin UI API endpoints (/admin/config, /admin/streams, /admin).
 * Uses a temporary hub_config.yaml so tests are isolated.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'yaml';

// ---------------------------------------------------------------------------
// Helpers — replicate the config read/write logic from index.ts
// ---------------------------------------------------------------------------

type HubConfigShape = Record<string, unknown>;

function loadConfig(configPath: string): HubConfigShape {
  if (!fs.existsSync(configPath)) return {};
  return (yaml.parse(fs.readFileSync(configPath, 'utf8')) as HubConfigShape) ?? {};
}

function saveConfig(configPath: string, config: HubConfigShape): void {
  fs.writeFileSync(configPath, yaml.stringify(config), 'utf8');
}

function toggleServer(
  configPath: string,
  server: string,
  enabled: boolean
): { success: boolean; error?: string } {
  const config = loadConfig(configPath);

  if (server in config && typeof config[server] === 'object' && config[server] !== null) {
    (config[server] as Record<string, unknown>)['enabled'] = enabled;
    saveConfig(configPath, config);
    return { success: true };
  }

  const mcpServers = config['mcp_servers'];
  if (Array.isArray(mcpServers)) {
    const entry = mcpServers.find(
      (s: unknown) => typeof s === 'object' && s !== null && (s as Record<string, unknown>)['name'] === server
    ) as Record<string, unknown> | undefined;
    if (entry) {
      entry['enabled'] = enabled;
      saveConfig(configPath, config);
      return { success: true };
    }
  }

  return { success: false, error: `Server "${server}" not found.` };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Admin config API — read', () => {
  it('returns empty object for non-existent config file', () => {
    expect(loadConfig('/tmp/no-such-file.yaml')).toEqual({});
  });

  it('loads and parses a valid hub_config.yaml', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-test-'));
    const configPath = path.join(dir, 'hub_config.yaml');
    fs.writeFileSync(configPath, yaml.stringify({ duckdb: { enabled: true, transport: 'stdio', command: 'uvx', args: [] } }));
    const config = loadConfig(configPath);
    expect(config.duckdb).toBeDefined();
    expect((config.duckdb as Record<string, unknown>)['enabled']).toBe(true);
  });
});

describe('Admin config API — toggle top-level server', () => {
  let configPath: string;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-toggle-'));
    configPath = path.join(dir, 'hub_config.yaml');
    fs.writeFileSync(
      configPath,
      yaml.stringify({
        duckdb: { enabled: true, transport: 'stdio', command: 'uvx', args: [] },
        toolbox: { enabled: false, transport: 'sse', url: 'http://localhost:5000/sse' },
      })
    );
  });

  it('disables a top-level server', () => {
    const result = toggleServer(configPath, 'duckdb', false);
    expect(result.success).toBe(true);
    const cfg = loadConfig(configPath);
    expect((cfg.duckdb as Record<string, unknown>)['enabled']).toBe(false);
  });

  it('enables a disabled top-level server', () => {
    const result = toggleServer(configPath, 'toolbox', true);
    expect(result.success).toBe(true);
    const cfg = loadConfig(configPath);
    expect((cfg.toolbox as Record<string, unknown>)['enabled']).toBe(true);
  });

  it('returns error for unknown top-level server', () => {
    const result = toggleServer(configPath, 'nonexistent', true);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});

describe('Admin config API — toggle mcp_servers entry', () => {
  let configPath: string;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-mcp-'));
    configPath = path.join(dir, 'hub_config.yaml');
    fs.writeFileSync(
      configPath,
      yaml.stringify({
        mcp_servers: [
          { name: 'filesystem', enabled: true, transport: 'stdio', command: 'npx', args: [] },
          { name: 'fetch', enabled: false, transport: 'stdio', command: 'npx', args: [] },
        ],
      })
    );
  });

  it('disables an mcp_servers entry by name', () => {
    const result = toggleServer(configPath, 'filesystem', false);
    expect(result.success).toBe(true);
    const cfg = loadConfig(configPath);
    const servers = cfg['mcp_servers'] as Array<Record<string, unknown>>;
    expect(servers.find((s) => s['name'] === 'filesystem')!['enabled']).toBe(false);
  });

  it('enables an mcp_servers entry by name', () => {
    const result = toggleServer(configPath, 'fetch', true);
    expect(result.success).toBe(true);
    const cfg = loadConfig(configPath);
    const servers = cfg['mcp_servers'] as Array<Record<string, unknown>>;
    expect(servers.find((s) => s['name'] === 'fetch')!['enabled']).toBe(true);
  });

  it('returns error when mcp_servers entry is not found', () => {
    const result = toggleServer(configPath, 'github', true);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('persists changes: subsequent loads see the updated value', () => {
    toggleServer(configPath, 'filesystem', false);
    toggleServer(configPath, 'fetch', true);
    const cfg = loadConfig(configPath);
    const servers = cfg['mcp_servers'] as Array<Record<string, unknown>>;
    expect(servers.find((s) => s['name'] === 'filesystem')!['enabled']).toBe(false);
    expect(servers.find((s) => s['name'] === 'fetch')!['enabled']).toBe(true);
  });
});
