/**
 * Kafka Message → Graph Data Transformer
 *
 * Converts Kafka messages (JSON payloads) into the canonical GraphData format.
 * Supports batch processing: multiple messages → multiple nodes/edges.
 */

import { GraphData, GraphNode, GraphEdge } from '../graph_schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KafkaMessage {
  /** Kafka message key (often used as entity ID) */
  key: string | null;
  /** JSON-parsed message value */
  value: Record<string, unknown>;
  /** Kafka topic name */
  topic: string;
  /** Partition number */
  partition?: number;
  /** Message offset */
  offset?: number;
  /** Message timestamp (epoch ms) */
  timestamp?: number;
}

export interface KafkaTransformConfig {
  /** Node category (default: topic name) */
  nodeCategory?: string;
  /** Field in the value to use as node ID (default: uses key, then offset) */
  idField?: string;
  /** Field in the value to use as edge target (creates edges if present) */
  targetField?: string;
  /** Relationship type for auto-created edges (default: "RELATED_TO") */
  relationship?: string;
  /** Whether to include Kafka metadata (topic, partition, offset) in properties */
  includeMetadata?: boolean;
}

// ---------------------------------------------------------------------------
// Transformer
// ---------------------------------------------------------------------------

/**
 * Transform an array of Kafka messages into GraphData.
 *
 * Each message becomes a node. If `targetField` is specified and the message
 * value contains that field, an edge is also created.
 */
export function kafkaMessageToGraph(
  messages: KafkaMessage[],
  config: KafkaTransformConfig = {}
): GraphData {
  const {
    idField,
    targetField,
    relationship = 'RELATED_TO',
    includeMetadata = true,
  } = config;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const category = config.nodeCategory ?? msg.topic;

    // Determine node ID: explicit field > key > fallback
    let nodeId: string;
    if (idField && msg.value[idField] != null) {
      nodeId = String(msg.value[idField]);
    } else if (msg.key != null) {
      nodeId = msg.key;
    } else {
      nodeId = `kafka_${msg.topic}_${msg.offset ?? i}`;
    }

    // Build properties
    const properties: Record<string, unknown> = { ...msg.value };
    if (includeMetadata) {
      properties._kafka = {
        topic: msg.topic,
        partition: msg.partition,
        offset: msg.offset,
        timestamp: msg.timestamp,
      };
    }

    nodes.push({ id: nodeId, category, properties });

    // Create edge if targetField is present and has a value
    if (targetField && msg.value[targetField] != null) {
      edges.push({
        id: `edge_${msg.topic}_${i}`,
        source: nodeId,
        target: String(msg.value[targetField]),
        relationship,
        properties: {},
      });
    }
  }

  return { nodes, edges };
}
