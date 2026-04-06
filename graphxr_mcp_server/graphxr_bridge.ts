/**
 * GraphXR Bridge — Passive SSE + REST Bridge
 *
 * Replaces the old WebSocket-based GraphXRClient.
 * Instead of the Hub connecting TO GraphXR, GraphXR discovers the Hub
 * and connects here via SSE to receive commands.
 *
 * Flow:
 *   1. GraphXR discovers Hub via GET /health + /mcp-info
 *   2. GraphXR subscribes to GET /graphxr/events (SSE)
 *   3. Hub pushes "command" events when MCP tools are invoked
 *   4. GraphXR executes commands and POSTs results to /graphxr/results
 */

import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { GraphData, GraphNode, GraphEdge, GraphState } from '../semantic_layer/graph_schema';

// ---------------------------------------------------------------------------
// Interface — drop-in replacement for the old GraphXRClient
// ---------------------------------------------------------------------------

export interface IGraphXRClient {
  pushGraph(data: GraphData): Promise<void>;
  addNodes(nodes: GraphNode[]): Promise<void>;
  addEdges(edges: GraphEdge[]): Promise<void>;
  updateNode(id: string, properties: Record<string, unknown>): Promise<void>;
  clearGraph(): Promise<void>;
  getGraphState(): Promise<GraphState>;
  getNodes(filter?: Record<string, unknown>): Promise<GraphNode[]>;
  getEdges(filter?: Record<string, unknown>): Promise<GraphEdge[]>;
  findNeighbors(nodeId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
  close(): void;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface GraphXRConnection {
  res: Response;
  connectedAt: string;
  userAgent?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export interface GraphXRBridgeOptions {
  requestTimeoutMs?: number;
  heartbeatIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// GraphXRBridge
// ---------------------------------------------------------------------------

export class GraphXRBridge implements IGraphXRClient {
  private readonly requestTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly connections = new Map<string, GraphXRConnection>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: GraphXRBridgeOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
    this.startHeartbeat();
  }

  // ── Connection management (called by Express routes) ────────────────────

  addConnection(connectionId: string, res: Response, meta?: { userAgent?: string }): void {
    this.connections.set(connectionId, {
      res,
      connectedAt: new Date().toISOString(),
      userAgent: meta?.userAgent,
    });
    this.sendSSE(res, 'connected', JSON.stringify({ connectionId }));
    console.log(`[graphxr-bridge] GraphXR connected: ${connectionId}`);
  }

  removeConnection(connectionId: string): void {
    this.connections.delete(connectionId);
    console.log(`[graphxr-bridge] GraphXR disconnected: ${connectionId}`);
  }

  handleResult(requestId: string, result: unknown, error?: string): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(requestId);

    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(result);
    }
    return true;
  }

  // ── Status / diagnostics ────────────────────────────────────────────────

  get connectedCount(): number {
    return this.connections.size;
  }

  get pendingCount(): number {
    return this.pendingRequests.size;
  }

  listConnections(): Array<{ connectionId: string; connectedAt: string; userAgent?: string }> {
    const list: Array<{ connectionId: string; connectedAt: string; userAgent?: string }> = [];
    for (const [id, conn] of this.connections) {
      list.push({ connectionId: id, connectedAt: conn.connectedAt, userAgent: conn.userAgent });
    }
    return list;
  }

  // ── IGraphXRClient implementation ───────────────────────────────────────

  async pushGraph(data: GraphData): Promise<void> {
    await this.send<void>('pushGraph', data);
  }

  async addNodes(nodes: GraphNode[]): Promise<void> {
    await this.send<void>('addNodes', { nodes });
  }

  async addEdges(edges: GraphEdge[]): Promise<void> {
    await this.send<void>('addEdges', { edges });
  }

  async updateNode(id: string, properties: Record<string, unknown>): Promise<void> {
    await this.send<void>('updateNode', { id, properties });
  }

  async clearGraph(): Promise<void> {
    await this.send<void>('clearGraph', {});
  }

  async getGraphState(): Promise<GraphState> {
    return this.send<GraphState>('getGraphState', {});
  }

  async getNodes(filter?: Record<string, unknown>): Promise<GraphNode[]> {
    return this.send<GraphNode[]>('getNodes', { filter: filter ?? {} });
  }

  async getEdges(filter?: Record<string, unknown>): Promise<GraphEdge[]> {
    return this.send<GraphEdge[]>('getEdges', { filter: filter ?? {} });
  }

  async findNeighbors(nodeId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    return this.send<{ nodes: GraphNode[]; edges: GraphEdge[] }>('findNeighbors', { nodeId });
  }

  close(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('[graphxr-bridge] Bridge closed'));
      this.pendingRequests.delete(id);
    }
    // Close all SSE connections
    for (const [id, conn] of this.connections) {
      conn.res.end();
      this.connections.delete(id);
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private send<T>(method: string, params: unknown): Promise<T> {
    if (this.connections.size === 0) {
      return Promise.reject(new Error(
        '[graphxr-bridge] No GraphXR instance connected. ' +
        'Open GraphXR and connect it to this Hub via GET /graphxr/events'
      ));
    }

    const requestId = randomUUID();

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`[graphxr-bridge] Request "${method}" timed out (${this.requestTimeoutMs}ms)`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      this.broadcast('command', JSON.stringify({ requestId, method, params }));
    });
  }

  private sendSSE(res: Response, event: string, data: string): void {
    try {
      res.write(`event: ${event}\ndata: ${data}\n\n`);
    } catch {
      // Connection may have been closed
    }
  }

  private broadcast(event: string, data: string): void {
    for (const conn of this.connections.values()) {
      this.sendSSE(conn.res, event, data);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const dead: string[] = [];
      for (const [id, conn] of this.connections) {
        try {
          conn.res.write(`event: heartbeat\ndata: {}\n\n`);
        } catch {
          dead.push(id);
        }
      }
      for (const id of dead) {
        this.removeConnection(id);
      }
    }, this.heartbeatIntervalMs);
  }
}
