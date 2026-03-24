/**
 * Tests for the Ollama MCP Client (mcp_client/ollama_client.ts).
 * Uses fetch mocking to avoid real HTTP calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaMcpClient } from '../mcp_client/ollama_client.js';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_MCP_INFO = {
  name: 'graphxr-mcp-server',
  version: '1.0.0',
  graphxrCompatible: true,
  tools: [
    {
      name: 'push_graph',
      description: 'Push graph data to GraphXR.',
      inputSchema: {
        type: 'object',
        properties: {
          nodes: { type: 'array' },
          edges: { type: 'array' },
        },
        required: ['nodes', 'edges'],
      },
    },
    {
      name: 'get_graph_state',
      description: 'Get graph summary.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
  ],
};

function ollamaTextResponse(text: string) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        message: { role: 'assistant', content: text, tool_calls: [] },
        done: true,
      }),
  };
}

function ollamaToolCallResponse(toolName: string, toolArgs: Record<string, unknown>) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: toolName, arguments: toolArgs } }],
        },
        done: true,
      }),
  };
}

function mcpInfoResponse() {
  return { ok: true, json: () => Promise.resolve(MOCK_MCP_INFO) };
}

function mcpToolResultResponse(result: unknown) {
  return { ok: true, json: () => Promise.resolve(result) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OllamaMcpClient — tool discovery', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/mcp-info')) return Promise.resolve(mcpInfoResponse());
      return Promise.resolve(ollamaTextResponse('ok'));
    }) as unknown as typeof fetch;
  });

  it('converts MCP tools to Ollama tool format', async () => {
    const client = new OllamaMcpClient({ mcpServerUrl: 'http://localhost:8899', ollamaUrl: 'http://localhost:11434' });
    const tools = await client.getTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].type).toBe('function');
    expect(tools[0].function.name).toBe('push_graph');
    expect(tools[0].function.parameters.type).toBe('object');
    expect(tools[0].function.parameters.required).toEqual(['nodes', 'edges']);
  });

  it('caches tools after first fetch', async () => {
    const client = new OllamaMcpClient({ mcpServerUrl: 'http://localhost:8899' });
    await client.getTools();
    await client.getTools();
    // /mcp-info should only be called once
    const mcpInfoCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes('/mcp-info')
    );
    expect(mcpInfoCalls.length).toBe(1);
  });

  it('clearToolCache causes re-fetch on next getTools()', async () => {
    const client = new OllamaMcpClient({ mcpServerUrl: 'http://localhost:8899' });
    await client.getTools();
    client.clearToolCache();
    await client.getTools();
    const mcpInfoCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes('/mcp-info')
    );
    expect(mcpInfoCalls.length).toBe(2);
  });
});

describe('OllamaMcpClient — chat', () => {
  it('returns plain text when Ollama does not call a tool', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/mcp-info')) return Promise.resolve(mcpInfoResponse());
      if (url.includes('/api/chat')) return Promise.resolve(ollamaTextResponse('Graph has 5 nodes.'));
      return Promise.resolve({ ok: false });
    }) as unknown as typeof fetch;

    const client = new OllamaMcpClient({ mcpServerUrl: 'http://localhost:8899' });
    const reply = await client.chat('How many nodes?');
    expect(reply).toBe('Graph has 5 nodes.');
  });

  it('invokes MCP tool and returns final response after tool call', async () => {
    let chatCallCount = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/mcp-info')) return Promise.resolve(mcpInfoResponse());
      if (url.includes('/api/chat')) {
        chatCallCount++;
        if (chatCallCount === 1) {
          // First call: Ollama requests a tool
          return Promise.resolve(
            ollamaToolCallResponse('push_graph', { nodes: [], edges: [] })
          );
        }
        // Second call: final answer
        return Promise.resolve(ollamaTextResponse('Graph pushed successfully.'));
      }
      if (url.includes('/messages')) {
        return Promise.resolve(mcpToolResultResponse({ result: 'ok' }));
      }
      return Promise.resolve({ ok: false });
    }) as unknown as typeof fetch;

    const client = new OllamaMcpClient({ mcpServerUrl: 'http://localhost:8899' });
    const reply = await client.chat('Push empty graph');
    expect(reply).toBe('Graph pushed successfully.');
    expect(chatCallCount).toBe(2);
  });

  it('handles 404 from /messages gracefully (no active SSE session)', async () => {
    let chatCallCount = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/mcp-info')) return Promise.resolve(mcpInfoResponse());
      if (url.includes('/api/chat')) {
        chatCallCount++;
        if (chatCallCount === 1) {
          // First call: Ollama requests a tool
          return Promise.resolve(ollamaToolCallResponse('get_graph_state', {}));
        }
        // Second call: Ollama answers after seeing the 404 note in tool result
        return Promise.resolve(ollamaTextResponse('I could not reach the MCP session.'));
      }
      if (url.includes('/messages')) {
        // Simulate no active SSE session
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: 'Session not found' }),
          text: () => Promise.resolve('Session not found'),
        });
      }
      return Promise.resolve({ ok: false });
    }) as unknown as typeof fetch;

    const client = new OllamaMcpClient({ mcpServerUrl: 'http://localhost:8899' });
    // Should not throw — 404 is handled gracefully and Ollama produces a final text answer
    const reply = await client.chat('State?');
    expect(reply).toContain('MCP');
    expect(chatCallCount).toBe(2);
  });
});

describe('OllamaMcpClient — error handling', () => {
  it('throws when /mcp-info returns non-200', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;
    const client = new OllamaMcpClient({ mcpServerUrl: 'http://localhost:8899' });
    await expect(client.getTools()).rejects.toThrow('503');
  });

  it('throws when Ollama API returns non-200', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/mcp-info')) return Promise.resolve(mcpInfoResponse());
      return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('Internal error') });
    }) as unknown as typeof fetch;

    const client = new OllamaMcpClient();
    await expect(client.chat('Hello')).rejects.toThrow('500');
  });
});
