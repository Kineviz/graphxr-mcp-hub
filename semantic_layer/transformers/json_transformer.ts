/**
 * JSON transformer
 * Converts a JSON array (or single object) into GraphData.
 */

import { GraphData, GraphNode, Lineage, makeLineage } from '../graph_schema.js';

export interface JsonTransformConfig {
  nodeCategory?: string;
  idField?: string;
  /**
   * Lineage metadata — which file / endpoint produced this data.
   * Pass at minimum `{ source: 'http-api', file: 'https://...' }`.
   */
  lineage?: Partial<Omit<Lineage, 'fetchedAt'>>;
}

export function jsonToGraph(
  data: unknown,
  config: JsonTransformConfig = {}
): GraphData {
  const { nodeCategory = 'Record', idField = 'id', lineage } = config;

  const resolvedLineage = lineage
    ? makeLineage(lineage.source ?? 'json', { file: lineage.file, query: lineage.query })
    : undefined;

  const items: Record<string, unknown>[] = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : [data as Record<string, unknown>];

  const nodes: GraphNode[] = items.map((item, i) => ({
    id: String(item[idField] ?? `node_${i}`),
    category: nodeCategory,
    properties: item,
    ...(resolvedLineage && { _lineage: resolvedLineage }),
  }));

  return { nodes, edges: [] };
}
