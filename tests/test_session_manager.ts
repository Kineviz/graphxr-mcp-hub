/**
 * Tests for multi-client session manager.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../graphxr_mcp_server/session_manager';

// Minimal mock for SSEServerTransport (we only need it as a token in the Map)
const mockTransport = {} as Parameters<SessionManager['register']>[1];

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it('registers and lists sessions', () => {
    manager.register('sess-1', mockTransport, 'Claude Desktop');
    manager.register('sess-2', mockTransport, 'GraphXR Agent');

    expect(manager.count).toBe(2);

    const sessions = manager.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].sessionId).toBe('sess-1');
    expect(sessions[0].clientName).toBe('Claude Desktop');
    expect(sessions[1].sessionId).toBe('sess-2');
  });

  it('unregisters sessions', () => {
    manager.register('sess-1', mockTransport);
    manager.register('sess-2', mockTransport);
    manager.unregister('sess-1');

    expect(manager.count).toBe(1);
    expect(manager.has('sess-1')).toBe(false);
    expect(manager.has('sess-2')).toBe(true);
  });

  it('retrieves transport by session ID', () => {
    const transport = { id: 'test' } as unknown as Parameters<SessionManager['register']>[1];
    manager.register('sess-1', transport);

    expect(manager.getTransport('sess-1')).toBe(transport);
    expect(manager.getTransport('nonexistent')).toBeUndefined();
  });

  it('updates last activity on touch', () => {
    manager.register('sess-1', mockTransport);
    const before = manager.listSessions()[0].lastActivity;

    // Small delay to ensure timestamp differs
    manager.touch('sess-1');
    const after = manager.listSessions()[0].lastActivity;

    expect(after).toBeDefined();
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it('checks session existence', () => {
    manager.register('sess-1', mockTransport);

    expect(manager.has('sess-1')).toBe(true);
    expect(manager.has('sess-99')).toBe(false);
  });

  it('broadcasts graph change to other sessions', () => {
    manager.register('sess-1', mockTransport);
    manager.register('sess-2', mockTransport);

    manager.broadcastGraphChange({
      type: 'push_graph',
      operationId: 'op1',
      timestamp: new Date().toISOString(),
      sourceSessionId: 'sess-1',
    });

    // sess-2 should have updated lastActivity (from the broadcast)
    const sessions = manager.listSessions();
    const sess2 = sessions.find((s) => s.sessionId === 'sess-2');
    expect(sess2?.lastActivity).toBeDefined();
  });

  it('clears all sessions', () => {
    manager.register('sess-1', mockTransport);
    manager.register('sess-2', mockTransport);
    manager.clear();

    expect(manager.count).toBe(0);
    expect(manager.listSessions()).toHaveLength(0);
  });

  it('listSessions excludes transport objects', () => {
    manager.register('sess-1', mockTransport);
    const sessions = manager.listSessions();

    // Should not contain transport key
    expect(sessions[0]).not.toHaveProperty('transport');
    expect(sessions[0]).toHaveProperty('sessionId');
    expect(sessions[0]).toHaveProperty('connectedAt');
    expect(sessions[0]).toHaveProperty('lastActivity');
  });
});
