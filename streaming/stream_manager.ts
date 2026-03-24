/**
 * Stream Manager — singleton registry of active stream subscriptions.
 *
 * The `stream_subscribe` MCP tool registers streams here, and the
 * GraphXR MCP Server pushes incremental GraphData to the WebGL canvas
 * as each message arrives.
 */

import { StreamAdapter, StreamEvent } from './stream_adapter.js';
import { GraphXRClient } from '../graphxr_mcp_server/graphxr_client.js';

export interface StreamSubscription {
  id: string;
  adapter: StreamAdapter;
  /** 'incremental' appends to graph; 'replace' replaces it on each message. */
  mode: 'incremental' | 'replace';
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  messageCount: number;
  errorCount: number;
  startedAt: string;
}

export class StreamManager {
  private readonly subscriptions = new Map<string, StreamSubscription>();
  private idCounter = 0;

  constructor(private readonly graphxrClient: GraphXRClient) {}

  // ---------------------------------------------------------------------------
  // Subscribe
  // ---------------------------------------------------------------------------

  async subscribe(adapter: StreamAdapter): Promise<string> {
    const id = `stream_${++this.idCounter}`;
    const sub: StreamSubscription = {
      id,
      adapter,
      mode: adapter.mode,
      status: 'connecting',
      messageCount: 0,
      errorCount: 0,
      startedAt: new Date().toISOString(),
    };
    this.subscriptions.set(id, sub);

    adapter.on((event: StreamEvent) => this.handleEvent(id, event));
    await adapter.connect();
    return id;
  }

  // ---------------------------------------------------------------------------
  // Unsubscribe
  // ---------------------------------------------------------------------------

  unsubscribe(id: string): boolean {
    const sub = this.subscriptions.get(id);
    if (!sub) return false;
    sub.adapter.disconnect();
    this.subscriptions.delete(id);
    return true;
  }

  // ---------------------------------------------------------------------------
  // List active subscriptions
  // ---------------------------------------------------------------------------

  listSubscriptions(): Array<Omit<StreamSubscription, 'adapter'>> {
    return Array.from(this.subscriptions.values()).map(({ adapter: _a, ...rest }) => rest);
  }

  // ---------------------------------------------------------------------------
  // Event handler — pushes data to GraphXR WebGL
  // ---------------------------------------------------------------------------

  private handleEvent(id: string, event: StreamEvent): void {
    const sub = this.subscriptions.get(id);
    if (!sub) return;

    switch (event.type) {
      case 'connected':
        sub.status = 'connected';
        break;

      case 'disconnected':
        sub.status = 'disconnected';
        break;

      case 'error':
        sub.status = 'error';
        sub.errorCount += 1;
        console.error(`[stream:${id}] Error:`, event.error.message);
        break;

      case 'data': {
        sub.messageCount += 1;
        const { nodes, edges } = event.payload;

        if (sub.mode === 'replace') {
          this.graphxrClient.pushGraph(event.payload).catch((err) => {
            console.error(`[stream:${id}] pushGraph failed:`, err.message);
          });
        } else {
          // incremental: push nodes and edges separately to avoid clearing the graph
          if (nodes.length > 0) {
            this.graphxrClient.addNodes(nodes).catch((err) => {
              console.error(`[stream:${id}] addNodes failed:`, err.message);
            });
          }
          if (edges.length > 0) {
            this.graphxrClient.addEdges(edges).catch((err) => {
              console.error(`[stream:${id}] addEdges failed:`, err.message);
            });
          }
        }
        break;
      }
    }
  }
}
