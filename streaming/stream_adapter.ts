/**
 * Stream Adapter — abstract interface for real-time data sources.
 *
 * Any streaming source (WebSocket, Kafka-over-WS, SSE feed, etc.)
 * implements this interface so the rest of the system can treat
 * them uniformly.
 */

import { GraphData } from '../semantic_layer/graph_schema.js';

export type StreamEvent =
  | { type: 'data'; payload: GraphData }
  | { type: 'error'; error: Error }
  | { type: 'connected' }
  | { type: 'disconnected'; reason: string };

export type StreamEventHandler = (event: StreamEvent) => void;

export interface StreamSourceConfig {
  /** Human-readable name for this stream, used in lineage metadata. */
  name: string;
  /** Mode: 'incremental' appends to the current graph; 'replace' replaces it. */
  mode?: 'incremental' | 'replace';
  /** Auto-reconnect after an error / disconnect. Defaults to true. */
  autoReconnect?: boolean;
  /** Delay (ms) before reconnecting. Defaults to 3000. */
  reconnectDelayMs?: number;
}

export abstract class StreamAdapter {
  protected readonly config: StreamSourceConfig;
  private readonly handlers: StreamEventHandler[] = [];

  constructor(config: StreamSourceConfig) {
    this.config = config;
  }

  /** Register an event handler. Returns an unsubscribe function. */
  on(handler: StreamEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx !== -1) this.handlers.splice(idx, 1);
    };
  }

  protected emit(event: StreamEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  /** Open the stream connection. */
  abstract connect(): Promise<void>;

  /** Close the stream connection. */
  abstract disconnect(): void;

  /** True if the stream is currently connected. */
  abstract get isConnected(): boolean;

  get name(): string {
    return this.config.name;
  }

  get mode(): 'incremental' | 'replace' {
    return this.config.mode ?? 'incremental';
  }
}
