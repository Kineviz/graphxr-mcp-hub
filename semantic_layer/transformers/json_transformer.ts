/**
 * JSON transformer
 * Converts a JSON array (or single object) into GraphData.
 */

import { GraphData, GraphNode } from '../graph_schema.js';

export interface JsonTransformConfig {
  nodeCategory?: string;
  idField?: string;
}

export function jsonToGraph(
  data: unknown,
  config: JsonTransformConfig = {}
): GraphData {
  const { nodeCategory = 'Record', idField = 'id' } = config;

  const items: Record<string, unknown>[] = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : [data as Record<string, unknown>];

  const nodes: GraphNode[] = items.map((item, i) => ({
    id: String(item[idField] ?? `node_${i}`),
    category: nodeCategory,
    properties: item,
  }));

  return { nodes, edges: [] };
}
