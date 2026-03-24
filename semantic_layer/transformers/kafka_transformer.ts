/**
 * Kafka Message Transformer
 *
 * Converts Kafka message payloads into GraphData so they can be pushed
 * incrementally to GraphXR. Designed to work with the WebSocketStreamAdapter.
 *
 * Typical usage:
 *   import { buildKafkaTransform } from '../semantic_layer/transformers/kafka_transformer.js';
 *   const transform = buildKafkaTransform({ nodeCategory: 'Event', idField: 'event_id' });
 *   const adapter = new WebSocketStreamAdapter({ url: '...', transform });
 */

import { GraphData, GraphNode, GraphEdge, makeLineage } from '../graph_schema.js';
import { KafkaMessage } from '../../streaming/websocket_stream.js';

export interface KafkaTransformConfig {
  /**
   * Category assigned to nodes created from Kafka message payloads.
   * Defaults to 'KafkaEvent'.
   */
  nodeCategory?: string;
  /**
   * Field in the message value used as the node id.
   * Defaults to 'id'. Falls back to the Kafka message key if the field is absent.
   */
  idField?: string;
  /**
   * Field in the message value pointing to a target node id (creates an edge).
   * Leave undefined to produce only nodes.
   */
  targetField?: string;
  /** Relationship label for edges. Defaults to 'RELATED_TO'. */
  relationship?: string;
  /**
   * If true, only include fields listed in `includeFields` in node properties.
   * If false (default), all fields are included.
   */
  selectFields?: boolean;
  includeFields?: string[];
}

/**
 * Returns a MessageTransformFn that converts Kafka messages to GraphData
 * using the provided config.
 */
export function buildKafkaTransform(config: KafkaTransformConfig = {}) {
  const {
    nodeCategory = 'KafkaEvent',
    idField = 'id',
    targetField,
    relationship = 'RELATED_TO',
    selectFields = false,
    includeFields = [],
  } = config;

  return function transform(msg: KafkaMessage, sourceName: string): GraphData | null {
    const value = msg.value;
    if (value === null || value === undefined) return null;

    // Handle both single-object and array payloads
    const items: Record<string, unknown>[] = Array.isArray(value)
      ? (value as Record<string, unknown>[])
      : [value as Record<string, unknown>];

    const lineage = makeLineage(sourceName, {
      file: msg.topic,
      query: msg.offset !== undefined ? `offset:${msg.offset}` : undefined,
    });

    const nodes: GraphNode[] = items.map((item, i) => {
      const nodeId = String(item[idField] ?? msg.key ?? `msg_${i}_${Date.now()}`);
      const properties = selectFields
        ? Object.fromEntries(includeFields.map((f) => [f, item[f]]))
        : item;
      return { id: nodeId, category: nodeCategory, properties, _lineage: lineage };
    });

    const edges: GraphEdge[] = targetField
      ? items
          .filter((item) => item[targetField] != null)
          .map((item, i) => ({
            id: `edge_${msg.offset ?? i}_${Date.now()}`,
            source: String(item[idField] ?? msg.key ?? `msg_${i}`),
            target: String(item[targetField!]),
            relationship,
            properties: {},
            _lineage: lineage,
          }))
      : [];

    return { nodes, edges };
  };
}
