/**
 * Kafka → GraphXR Bridge
 *
 * Consumes messages from a Kafka-compatible WebSocket endpoint and
 * pushes them to GraphXR in real-time via the graph transformer pipeline.
 *
 * Architecture:
 *   Kafka WebSocket Proxy  →  KafkaBridge  →  kafkaMessageToGraph  →  GraphXRClient
 *
 * This bridge connects to a Kafka WebSocket proxy (e.g., kafka-ws, kafka-proxy)
 * rather than directly to Kafka brokers, keeping the dependency tree lightweight
 * (no native Kafka client library needed).
 */

import WebSocket from 'ws';
import { IGraphXRClient } from './graphxr_bridge';
import { kafkaMessageToGraph, KafkaMessage, KafkaTransformConfig } from '../semantic_layer/transformers/kafka_transformer';
import { LineageTracker, generateOperationId } from '../semantic_layer/lineage';
import { attachLineage } from '../semantic_layer/lineage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KafkaBridgeConfig {
  /** WebSocket URL of the Kafka proxy (e.g., ws://localhost:9092/ws) */
  wsUrl: string;
  /** Kafka topics to subscribe to */
  topics: string[];
  /** Consumer group ID */
  groupId?: string;
  /** Transform config for converting messages to graph data */
  transformConfig?: KafkaTransformConfig;
  /** Batch size — accumulate this many messages before pushing (default: 10) */
  batchSize?: number;
  /** Batch timeout in ms — push accumulated messages after this interval (default: 5000) */
  batchTimeoutMs?: number;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Reconnect delay in ms (default: 3000) */
  reconnectDelayMs?: number;
}

export type KafkaBridgeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// ---------------------------------------------------------------------------
// KafkaBridge
// ---------------------------------------------------------------------------

export class KafkaBridge {
  private ws: WebSocket | null = null;
  private buffer: KafkaMessage[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private _status: KafkaBridgeStatus = 'disconnected';
  private readonly config: Required<
    Pick<KafkaBridgeConfig, 'batchSize' | 'batchTimeoutMs' | 'autoReconnect' | 'reconnectDelayMs'>
  > & KafkaBridgeConfig;

  constructor(
    private readonly graphxrClient: IGraphXRClient,
    config: KafkaBridgeConfig,
    private readonly lineageTracker?: LineageTracker
  ) {
    this.config = {
      ...config,
      batchSize: config.batchSize ?? 10,
      batchTimeoutMs: config.batchTimeoutMs ?? 5000,
      autoReconnect: config.autoReconnect ?? true,
      reconnectDelayMs: config.reconnectDelayMs ?? 3000,
    };
  }

  get status(): KafkaBridgeStatus {
    return this._status;
  }

  /** Start consuming from the Kafka WebSocket proxy. */
  start(): void {
    if (this._status === 'connected' || this._status === 'connecting') return;
    this._status = 'connecting';

    const ws = new WebSocket(this.config.wsUrl);

    ws.on('open', () => {
      this._status = 'connected';
      // Subscribe to topics
      ws.send(JSON.stringify({
        action: 'subscribe',
        topics: this.config.topics,
        groupId: this.config.groupId,
      }));
      // Start batch timer
      this.startBatchTimer();
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as KafkaMessage;
        this.buffer.push(msg);
        if (this.buffer.length >= this.config.batchSize) {
          this.flush();
        }
      } catch {
        // Ignore non-JSON messages
      }
    });

    ws.on('close', () => {
      this._status = 'disconnected';
      this.stopBatchTimer();
      if (this.config.autoReconnect) {
        setTimeout(() => this.start(), this.config.reconnectDelayMs);
      }
    });

    ws.on('error', () => {
      this._status = 'error';
    });

    this.ws = ws;
  }

  /** Stop consuming and disconnect. */
  stop(): void {
    this.config.autoReconnect = false;
    this.stopBatchTimer();
    this.flush();
    this.ws?.close();
    this.ws = null;
    this._status = 'disconnected';
  }

  /** Flush buffered messages to GraphXR. */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const messages = this.buffer.splice(0);
    const graphData = kafkaMessageToGraph(messages, this.config.transformConfig);

    if (graphData.nodes.length === 0) return;

    const operationId = generateOperationId();
    const lineage = {
      source: `kafka:${this.config.topics.join(',')}`,
      operation: 'kafka_stream',
      timestamp: new Date().toISOString(),
      operationId,
    };

    const tagged = attachLineage(graphData, lineage);

    try {
      await this.graphxrClient.addNodes(tagged.nodes);
      if (tagged.edges.length > 0) {
        await this.graphxrClient.addEdges(tagged.edges);
      }
      this.lineageTracker?.record({
        ...lineage,
        nodeCount: tagged.nodes.length,
        edgeCount: tagged.edges.length,
      });
    } catch {
      // Re-buffer on failure for next attempt
      this.buffer.unshift(...messages);
    }
  }

  private startBatchTimer(): void {
    this.batchTimer = setInterval(() => this.flush(), this.config.batchTimeoutMs);
  }

  private stopBatchTimer(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
  }
}
