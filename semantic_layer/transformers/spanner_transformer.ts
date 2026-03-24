/**
 * Spanner/SQL transformer
 * Converts SQL query results (rows) from Spanner or PostgreSQL into GraphData.
 */

import { GraphData, GraphNode, GraphEdge, Lineage, makeLineage } from '../graph_schema.js';

export interface SpannerTransformConfig {
  nodeCategory?: string;
  idColumn?: string;
  sourceColumn?: string | null;
  targetColumn?: string | null;
  relationship?: string;
  /**
   * Lineage metadata for this query (e.g. `{ source: 'spanner', query: 'SELECT ...' }`).
   */
  lineage?: Partial<Omit<Lineage, 'fetchedAt'>>;
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
    lineage,
  } = config;

  const resolvedLineage = lineage
    ? makeLineage(lineage.source ?? 'spanner', { file: lineage.file, query: lineage.query })
    : undefined;

  const nodes: GraphNode[] = rows.map((row, i) => ({
    id: String(row[idColumn] ?? `node_${i}`),
    category: nodeCategory,
    properties: row,
    ...(resolvedLineage && { _lineage: resolvedLineage }),
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
            ...(resolvedLineage && { _lineage: resolvedLineage }),
          }))
      : [];

  return { nodes, edges };
}
