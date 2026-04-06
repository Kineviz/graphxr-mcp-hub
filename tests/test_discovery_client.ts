/**
 * Tests for the MCP server auto-discovery client.
 */

import { describe, it, expect } from 'vitest';
import { discoverMcpServer } from '../graphxr_mcp_server/discovery_client';

describe('discoverMcpServer', () => {
  it('returns unavailable when no server is running', async () => {
    const result = await discoverMcpServer({
      baseUrl: 'http://localhost:19999', // unlikely to be in use
      timeoutMs: 1000,
      retries: 0,
    });
    expect(result.available).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns unavailable when scanning empty port range', async () => {
    const result = await discoverMcpServer({
      ports: [19998],
      timeoutMs: 1000,
      retries: 0,
    });
    expect(result.available).toBe(false);
  });

  it('uses default port 8899 when no options provided', async () => {
    const result = await discoverMcpServer({ timeoutMs: 500, retries: 0 });
    // Will likely fail (server not running in test), but should not throw
    expect(result).toHaveProperty('available');
    expect(result).toHaveProperty('url');
    expect(result.url).toContain('8899');
  });
});
