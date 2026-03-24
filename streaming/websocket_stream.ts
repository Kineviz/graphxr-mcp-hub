/**
 * WebSocket Stream Adapter
 *
 * Connects to any WebSocket endpoint that streams JSON messages and
 * converts them to incremental GraphData updates.
 *
 * Compatible with:
 *   - Kafka WebSocket bridges (e.g. Redpanda Console WS, kafka-websocket)
 *   - Server-Sent Events proxied as WebSocket
 *   - Any custom real-time JSON event source
 *
 * Expected message format on the wire (each WS frame):
 *   {
 *     "key":   "<string|null>",     // Kafka message key (optional)
 *     "value": { ... }              // Kafka/stream message payload (JSON)
 *     "topic": "<string>",          // Source topic name (optional)
 *     "offset": <number>            // Kafka offset (optional)
 *   }
 *
 * The transform function converts raw payloads to GraphData.
 * A default identity transformer is provided for payloads that are
 * already in { nodes, edges } format.
 */

import WebSocket from 'ws';
import { StreamAdapter, StreamSourceConfig } from './stream_adapter.js';
import { GraphData } from '../semantic_layer/graph_schema.js';
import { makeLineage } from '../semantic_layer/graph_schema.js';

export interface KafkaMessage {
  key: string | null;
  value: unknown;
  topic?: string;
  offset?: number;
  partition?: number;
  timestamp?: string;
}

export type MessageTransformFn = (msg: KafkaMessage, sourceName: string) => GraphData | null;

export interface WebSocketStreamConfig extends StreamSourceConfig {
  /** WebSocket URL, e.g. "ws://localhost:9092/topics/events" */
  url: string;
  /**
   * Transform a raw Kafka/stream message into GraphData.
   * Return null to skip this message.
   * Defaults to an identity transformer that expects the payload to already
   * be in { nodes: [...], edges: [...] } format.
   */
  transform?: MessageTransformFn;
}

// ---------------------------------------------------------------------------
// Default transform: payload is already { nodes, edges }
// ---------------------------------------------------------------------------

const defaultTransform: MessageTransformFn = (msg, sourceName) => {
  const v = msg.value as Record<string, unknown>;
  if (!v || typeof v !== 'object') return null;

  const nodes = Array.isArray(v['nodes']) ? v['nodes'] : [];
  const edges = Array.isArray(v['edges']) ? v['edges'] : [];

  if (nodes.length === 0 && edges.length === 0) return null;

  const lineage = makeLineage(sourceName, {
    file: msg.topic,
    query: msg.offset !== undefined ? `offset:${msg.offset}` : undefined,
  });

  return {
    nodes: (nodes as Array<{ id: string; category: string; properties?: Record<string, unknown> }>).map(
      (n) => ({ ...n, properties: n.properties ?? {}, _lineage: lineage })
    ),
    edges: (edges as Array<{ id: string; source: string; target: string; relationship: string; properties?: Record<string, unknown> }>).map(
      (e) => ({ ...e, properties: e.properties ?? {}, _lineage: lineage })
    ),
  };
};

// ---------------------------------------------------------------------------
// WebSocketStreamAdapter
// ---------------------------------------------------------------------------

export class WebSocketStreamAdapter extends StreamAdapter {
  private readonly wsUrl: string;
  private readonly transform: MessageTransformFn;
  private readonly reconnectDelayMs: number;
  private readonly autoReconnect: boolean;

  private ws: WebSocket | null = null;
  private _connected = false;
  private _stopping = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(config: WebSocketStreamConfig) {
    super(config);
    this.wsUrl = config.url;
    this.transform = config.transform ?? defaultTransform;
    this.reconnectDelayMs = config.reconnectDelayMs ?? 3_000;
    this.autoReconnect = config.autoReconnect ?? true;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    if (this._connected) return;
    this._stopping = false;
    return new Promise<void>((resolve, reject) => {
      this.openSocket(resolve, reject);
    });
  }

  disconnect(): void {
    this._stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this._connected = false;
  }

  // ---------------------------------------------------------------------------
  // Internal WebSocket lifecycle
  // ---------------------------------------------------------------------------

  private openSocket(
    onOpen?: (value: void) => void,
    onOpenError?: (reason: Error) => void
  ): void {
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.on('open', () => {
      this._connected = true;
      this.emit({ type: 'connected' });
      onOpen?.();
    });

    ws.on('message', (data: Buffer) => {
      try {
        const raw = JSON.parse(data.toString()) as KafkaMessage;
        const graphData = this.transform(raw, this.config.name);
        if (graphData) {
          this.emit({ type: 'data', payload: graphData });
        }
      } catch (err) {
        this.emit({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) });
      }
    });

    ws.on('error', (err) => {
      this._connected = false;
      this.emit({ type: 'error', error: err });
      onOpenError?.(err);
      // openError path: reconnect if configured
      if (this.autoReconnect && !this._stopping) {
        this.scheduleReconnect();
      }
    });

    ws.on('close', (code, reason) => {
      this._connected = false;
      this.emit({ type: 'disconnected', reason: `code=${code} ${reason}` });
      if (this.autoReconnect && !this._stopping) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this._stopping) {
        this.openSocket();
      }
    }, this.reconnectDelayMs);
  }
}
