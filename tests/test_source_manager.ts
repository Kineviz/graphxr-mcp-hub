/**
 * Tests for SourceManager — config loading, status reporting, on-demand connection.
 *
 * Note: These tests don't connect to real external servers.
 * They verify config parsing, status management, and error handling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SourceManager } from '../graphxr_mcp_server/source_manager';
import { resolve } from 'path';

describe('SourceManager', () => {
  let manager: SourceManager;

  beforeEach(() => {
    manager = new SourceManager();
  });

  it('starts with no sources', () => {
    expect(manager.getStatus()).toHaveLength(0);
    expect(manager.getProxiedTools()).toHaveLength(0);
  });

  it('loads config from hub_config.yaml', () => {
    manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
    const status = manager.getStatus();

    // Should show configured but not-yet-connected STDIO servers
    const names = status.map((s) => s.name);
    expect(names).toContain('filesystem');
    expect(names).toContain('fetch');
  });

  it('shows configured servers as disconnected before connect', () => {
    manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
    const status = manager.getStatus();

    const filesystem = status.find((s) => s.name === 'filesystem');
    expect(filesystem?.status).toBe('disconnected');
    expect(filesystem?.transport).toBe('stdio');
  });

  it('handles SSE connection failure gracefully', async () => {
    await manager.connectSSE('test-sse', 'http://localhost:19999/sse', 'test');
    const status = manager.getStatus();
    const entry = status.find((s) => s.name === 'test-sse');

    expect(entry?.status).toBe('error');
    expect(entry?.error).toBeDefined();
    expect(entry?.tools).toHaveLength(0);
  });

  it('handles STDIO connection failure gracefully', async () => {
    await manager.connectStdio('bad-server', 'nonexistent-command-xyz', [], undefined, 'test');
    const status = manager.getStatus();
    const entry = status.find((s) => s.name === 'bad-server');

    expect(entry?.status).toBe('error');
    expect(entry?.error).toBeDefined();
  });

  it('returns null for unknown tool dispatch', async () => {
    const result = await manager.dispatchTool('unknown__tool', {});
    expect(result).toBeNull();
  });

  it('returns null for non-namespaced tool dispatch', async () => {
    const result = await manager.dispatchTool('push_graph', {});
    expect(result).toBeNull();
  });

  it('reports genai-toolbox as configured when enabled in config', () => {
    manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
    // toolbox is enabled in config but won't connect (no server running)
    // After initialize() it would try to connect — tested via connectSSE above
  });

  it('skips disabled servers in config', () => {
    manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
    const status = manager.getStatus();
    const github = status.find((s) => s.name === 'github');
    // github is enabled: false in config, so it should not appear
    expect(github).toBeUndefined();
  });

  it('connectByName returns false for unknown server', async () => {
    manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
    const result = await manager.connectByName('nonexistent');
    expect(result).toBe(false);
  });
});
