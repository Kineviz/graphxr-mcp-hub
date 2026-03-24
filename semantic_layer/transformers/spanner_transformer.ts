/**
 * Spanner/SQL transformer
 * Converts SQL query results (rows) from Spanner or PostgreSQL into GraphData.
 */

import { GraphData, GraphNode, GraphEdge } from '../graph_schema.js';

export interface SpannerTransformConfig {
  nodeCategory?: string;
  idColumn?: string;
  sourceColumn?: string | null;
  targetColumn?: string | null;
  relationship?: string;
}

export function spannerResultToGraph(
  rows: Record<string, unknown>[],
  config: SpannerTransformConfig = {}
): GraphData {
  const {
    nodeCategory = 'Record',
    idColumn = 'id',
    sourceColumn = null,
    targetColumn = null,
    relationship = 'RELATED_TO',
  } = config;

  const nodes: GraphNode[] = rows.map((row, i) => ({
    id: String(row[idColumn] ?? `node_${i}`),
    category: nodeCategory,
    properties: row,
  }));

  const edges: GraphEdge[] =
    sourceColumn && targetColumn
      ? rows
          .filter((row) => row[sourceColumn] != null && row[targetColumn!] != null)
          .map((row, i) => ({
            id: `edge_${i}`,
            source: String(row[sourceColumn]),
            target: String(row[targetColumn!]),
            relationship,
            properties: {},
          }))
      : [];

  return { nodes, edges };
}
