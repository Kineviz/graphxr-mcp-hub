/**
 * Tests for the streaming infrastructure (StreamAdapter, StreamManager).
 * Uses a mock adapter to avoid real WebSocket connections.
 */

import { describe, it, expect, vi } from 'vitest';
import { StreamAdapter, StreamSourceConfig, StreamEvent, StreamEventHandler } from '../streaming/stream_adapter.js';
import { StreamManager } from '../streaming/stream_manager.js';
import { GraphXRClient } from '../graphxr_mcp_server/graphxr_client.js';

// ---------------------------------------------------------------------------
// Mock StreamAdapter
// ---------------------------------------------------------------------------

class MockStreamAdapter extends StreamAdapter {
  private _connected = false;

  constructor(config?: Partial<StreamSourceConfig>) {
    super({ name: 'mock', mode: 'incremental', ...config });
  }

  get isConnected() { return this._connected; }

  async connect(): Promise<void> {
    this._connected = true;
    this.emit({ type: 'connected' });
  }

  disconnect(): void {
    this._connected = false;
    this.emit({ type: 'disconnected', reason: 'manual' });
  }

  /** Test helper: push a synthetic data event. */
  push(event: StreamEvent): void {
    this.emit(event);
  }
}

// ---------------------------------------------------------------------------
// Mock GraphXRClient
// ---------------------------------------------------------------------------

function mockGraphxrClient(): GraphXRClient {
  const client = new GraphXRClient('ws://localhost:0', { connectTimeoutMs: 100 });
  vi.spyOn(client, 'pushGraph').mockResolvedValue(undefined);
  vi.spyOn(client, 'addNodes').mockResolvedValue(undefined);
  vi.spyOn(client, 'addEdges').mockResolvedValue(undefined);
  return client;
}

// ---------------------------------------------------------------------------
// StreamAdapter tests
// ---------------------------------------------------------------------------

describe('StreamAdapter — event bus', () => {
  it('emits connected event on connect()', async () => {
    const adapter = new MockStreamAdapter();
    const events: StreamEvent[] = [];
    adapter.on((e) => events.push(e));
    await adapter.connect();
    expect(events.some((e) => e.type === 'connected')).toBe(true);
  });

  it('emits disconnected event on disconnect()', async () => {
    const adapter = new MockStreamAdapter();
    await adapter.connect();
    const events: StreamEvent[] = [];
    adapter.on((e) => events.push(e));
    adapter.disconnect();
    expect(events.some((e) => e.type === 'disconnected')).toBe(true);
  });

  it('on() returns an unsubscribe function', async () => {
    const adapter = new MockStreamAdapter();
    const calls: number[] = [];
    const unsub = adapter.on(() => calls.push(1));
    await adapter.connect();
    const countAfterConnect = calls.length;
    unsub();
    adapter.disconnect();
    expect(calls.length).toBe(countAfterConnect); // no new calls after unsubscribe
  });

  it('emits data event with payload', async () => {
    const adapter = new MockStreamAdapter();
    const payloads: unknown[] = [];
    adapter.on((e) => { if (e.type === 'data') payloads.push(e.payload); });
    await adapter.connect();
    adapter.push({ type: 'data', payload: { nodes: [{ id: '1', category: 'X', properties: {} }], edges: [] } });
    expect(payloads).toHaveLength(1);
  });

  it('reports name and mode from config', () => {
    const adapter = new MockStreamAdapter({ name: 'my-stream', mode: 'replace' });
    expect(adapter.name).toBe('my-stream');
    expect(adapter.mode).toBe('replace');
  });

  it('defaults mode to incremental', () => {
    const adapter = new MockStreamAdapter({ name: 'x' });
    expect(adapter.mode).toBe('incremental');
  });
});

// ---------------------------------------------------------------------------
// StreamManager tests
// ---------------------------------------------------------------------------

describe('StreamManager', () => {
  it('subscribe returns a string ID', async () => {
    const client = mockGraphxrClient();
    const manager = new StreamManager(client);
    const adapter = new MockStreamAdapter();
    const id = await manager.subscribe(adapter);
    expect(typeof id).toBe('string');
    expect(id).toMatch(/stream_\d+/);
    manager.unsubscribe(id);
  });

  it('listSubscriptions shows the registered subscription', async () => {
    const client = mockGraphxrClient();
    const manager = new StreamManager(client);
    const adapter = new MockStreamAdapter({ name: 'test-stream' });
    const id = await manager.subscribe(adapter);
    const list = manager.listSubscriptions();
    expect(list.some((s) => s.id === id)).toBe(true);
    expect(list.find((s) => s.id === id)?.status).toBe('connected');
    manager.unsubscribe(id);
  });

  it('unsubscribe returns true and removes the subscription', async () => {
    const client = mockGraphxrClient();
    const manager = new StreamManager(client);
    const adapter = new MockStreamAdapter();
    const id = await manager.subscribe(adapter);
    expect(manager.unsubscribe(id)).toBe(true);
    expect(manager.listSubscriptions().some((s) => s.id === id)).toBe(false);
  });

  it('unsubscribe returns false for unknown id', () => {
    const client = mockGraphxrClient();
    const manager = new StreamManager(client);
    expect(manager.unsubscribe('nonexistent')).toBe(false);
  });

  it('calls addNodes/addEdges in incremental mode on data event', async () => {
    const client = mockGraphxrClient();
    const manager = new StreamManager(client);
    const adapter = new MockStreamAdapter({ mode: 'incremental' });
    const id = await manager.subscribe(adapter);

    adapter.push({
      type: 'data',
      payload: {
        nodes: [{ id: '1', category: 'User', properties: {} }],
        edges: [{ id: 'e1', source: '1', target: '2', relationship: 'KNOWS', properties: {} }],
      },
    });

    // Allow async microtasks to flush
    await new Promise((r) => setTimeout(r, 10));
    expect(client.addNodes).toHaveBeenCalled();
    expect(client.addEdges).toHaveBeenCalled();
    manager.unsubscribe(id);
  });

  it('calls pushGraph in replace mode on data event', async () => {
    const client = mockGraphxrClient();
    const manager = new StreamManager(client);
    const adapter = new MockStreamAdapter({ mode: 'replace' });
    const id = await manager.subscribe(adapter);

    adapter.push({
      type: 'data',
      payload: {
        nodes: [{ id: '1', category: 'User', properties: {} }],
        edges: [],
      },
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(client.pushGraph).toHaveBeenCalled();
    manager.unsubscribe(id);
  });

  it('increments messageCount on each data event', async () => {
    const client = mockGraphxrClient();
    const manager = new StreamManager(client);
    const adapter = new MockStreamAdapter();
    const id = await manager.subscribe(adapter);

    for (let i = 0; i < 3; i++) {
      adapter.push({ type: 'data', payload: { nodes: [{ id: String(i), category: 'X', properties: {} }], edges: [] } });
    }
    await new Promise((r) => setTimeout(r, 10));

    const sub = manager.listSubscriptions().find((s) => s.id === id);
    expect(sub?.messageCount).toBe(3);
    manager.unsubscribe(id);
  });

  it('increments errorCount on error events', async () => {
    const client = mockGraphxrClient();
    const manager = new StreamManager(client);
    const adapter = new MockStreamAdapter();
    const id = await manager.subscribe(adapter);

    adapter.push({ type: 'error', error: new Error('boom') });
    await new Promise((r) => setTimeout(r, 10));

    const sub = manager.listSubscriptions().find((s) => s.id === id);
    expect(sub?.errorCount).toBe(1);
    manager.unsubscribe(id);
  });
});
