/**
 * Multi-Client Session Manager
 *
 * Tracks active MCP client sessions and supports broadcasting
 * graph change notifications to all connected clients.
 */

import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionInfo {
  sessionId: string;
  connectedAt: string;
  clientName?: string;
  lastActivity: string;
  transport: SSEServerTransport;
}

export interface GraphChangeEvent {
  type: 'push_graph' | 'add_nodes' | 'add_edges' | 'update_node' | 'clear_graph';
  operationId: string;
  timestamp: string;
  sourceSessionId?: string;
}

// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------

export class SessionManager {
  private sessions = new Map<string, SessionInfo>();

  /** Register a new client session. */
  register(sessionId: string, transport: SSEServerTransport, clientName?: string): void {
    const now = new Date().toISOString();
    this.sessions.set(sessionId, {
      sessionId,
      connectedAt: now,
      clientName,
      lastActivity: now,
      transport,
    });
  }

  /** Remove a client session. */
  unregister(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Get a session's transport by ID. */
  getTransport(sessionId: string): SSEServerTransport | undefined {
    return this.sessions.get(sessionId)?.transport;
  }

  /** Update the last activity timestamp for a session. */
  touch(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date().toISOString();
    }
  }

  /** Get summary info about all active sessions (without transport objects). */
  listSessions(): Array<Omit<SessionInfo, 'transport'>> {
    return Array.from(this.sessions.values()).map(({ transport: _, ...info }) => info);
  }

  /** Get the number of active sessions. */
  get count(): number {
    return this.sessions.size;
  }

  /** Check if a session exists. */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Broadcast a graph change notification to all sessions except the originator.
   * This allows other clients to know the graph has been modified and optionally refresh.
   *
   * Note: SSE transport doesn't support server-initiated pushes beyond the MCP protocol,
   * so this records the event for polling via /sessions endpoint.
   */
  broadcastGraphChange(event: GraphChangeEvent): void {
    // Record the event timestamp on all sessions except the source
    for (const [id, session] of this.sessions) {
      if (id !== event.sourceSessionId) {
        session.lastActivity = event.timestamp;
      }
    }
  }

  /** Clear all sessions. */
  clear(): void {
    this.sessions.clear();
  }
}
