/**
 * @deprecated Use GraphXRBridge from './graphxr_bridge' instead.
 * This file will be removed in v0.2.0.
 *
 * Legacy WebSocket-based client that actively connects TO GraphXR.
 * The new architecture inverts this: GraphXR discovers and connects to the Hub
 * via SSE + REST (see graphxr_bridge.ts).
 */

import WebSocket from 'ws';
import { GraphData, GraphNode, GraphEdge, GraphState } from '../semantic_layer/graph_schema';

export interface GraphXRClientOptions {
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

export class GraphXRClient {
  private readonly wsUrl: string;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private messageIdCounter = 0;

  constructor(wsUrl: string, options: GraphXRClientOptions = {}) {
    this.wsUrl = wsUrl;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  }

  // ---------------------------------------------------------------------------
  // Connection management
  // ---------------------------------------------------------------------------

  private async ensureConnected(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return this.ws;
    }

    return new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error(`[graphxr-mcp] Connection timeout to ${this.wsUrl}`));
      }, this.connectTimeoutMs);

      ws.on('open', () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve(ws);
      });

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as { id?: string; result?: unknown; error?: string };
          if (msg.id) {
            const pending = this.pendingRequests.get(msg.id);
            if (pending) {
              clearTimeout(pending.timer);
              this.pendingRequests.delete(msg.id);
              if (msg.error) {
                pending.reject(new Error(msg.error));
              } else {
                pending.resolve(msg.result);
              }
            }
          }
        } catch {
          // Ignore non-JSON messages
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      ws.on('close', () => {
        this.ws = null;
        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(new Error('[graphxr-mcp] WebSocket closed unexpectedly'));
          this.pendingRequests.delete(id);
        }
      });
    });
  }

  private async send<T>(method: string, params: unknown): Promise<T> {
    const ws = await this.ensureConnected();
    const id = String(++this.messageIdCounter);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`[graphxr-mcp] Request "${method}" timed out`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // ---------------------------------------------------------------------------
  // Push direction (MCP → GraphXR WebGL)
  // ---------------------------------------------------------------------------

  /** Replace the entire graph in the GraphXR canvas. */
  async pushGraph(data: GraphData): Promise<void> {
    await this.send<void>('pushGraph', data);
  }

  /** Incrementally add nodes without clearing the existing graph. */
  async addNodes(nodes: GraphNode[]): Promise<void> {
    await this.send<void>('addNodes', { nodes });
  }

  /** Incrementally add edges without clearing the existing graph. */
  async addEdges(edges: GraphEdge[]): Promise<void> {
    await this.send<void>('addEdges', { edges });
  }

  /** Update properties on a single node. */
  async updateNode(id: string, properties: Record<string, unknown>): Promise<void> {
    await this.send<void>('updateNode', { id, properties });
  }

  /** Clear all nodes and edges from the GraphXR canvas. */
  async clearGraph(): Promise<void> {
    await this.send<void>('clearGraph', {});
  }

  // ---------------------------------------------------------------------------
  // Query direction (GraphXR WebGL → MCP)
  // ---------------------------------------------------------------------------

  /** Get a summary of the current graph state (node/edge counts, categories). */
  async getGraphState(): Promise<GraphState> {
    return this.send<GraphState>('getGraphState', {});
  }

  /** Query nodes from the current graph, optionally filtered by category/property. */
  async getNodes(filter?: Record<string, unknown>): Promise<GraphNode[]> {
    return this.send<GraphNode[]>('getNodes', { filter: filter ?? {} });
  }

  /** Query edges from the current graph, optionally filtered by relationship type. */
  async getEdges(filter?: Record<string, unknown>): Promise<GraphEdge[]> {
    return this.send<GraphEdge[]>('getEdges', { filter: filter ?? {} });
  }

  /** Find all neighbors of the specified node. */
  async findNeighbors(nodeId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    return this.send<{ nodes: GraphNode[]; edges: GraphEdge[] }>('findNeighbors', { nodeId });
  }

  /** Close the WebSocket connection. */
  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
