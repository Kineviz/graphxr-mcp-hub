/**
 * CSV/DuckDB transformer
 * Converts tabular query results (from DuckDB MCP Server) into GraphData.
 */

import { GraphData, GraphNode, GraphEdge, Lineage, makeLineage } from '../graph_schema.js';

export interface CsvTransformConfig {
  /** Category label for each row-node (e.g. "User", "Product"). */
  nodeCategory?: string;
  /** Column used as the node id. */
  idColumn?: string;
  /** Column holding the target node id (creates an edge from idColumn → targetColumn). */
  targetColumn?: string | null;
  /** Relationship label for edges created from targetColumn. */
  relationship?: string;
  /**
   * Lineage metadata — which file / query produced this data.
   * Pass at minimum `{ source: 'duckdb', file: '/data/users.csv' }`.
   */
  lineage?: Partial<Omit<Lineage, 'fetchedAt'>>;
}

export function csvResultToGraph(
  rows: Record<string, unknown>[],
  config: CsvTransformConfig = {}
): GraphData {
  const {
    nodeCategory = 'Record',
    idColumn = 'id',
    targetColumn = null,
    relationship = 'RELATED_TO',
    lineage,
  } = config;

  const resolvedLineage = lineage
    ? makeLineage(lineage.source ?? 'duckdb', { file: lineage.file, query: lineage.query })
    : undefined;

  const nodes: GraphNode[] = rows.map((row) => ({
    id: String(row[idColumn] ?? Math.random()),
    category: nodeCategory,
    properties: row,
    ...(resolvedLineage && { _lineage: resolvedLineage }),
  }));

  const edges: GraphEdge[] = targetColumn
    ? rows
        .filter((row) => row[targetColumn] != null)
        .map((row, i) => ({
          id: `edge_${i}`,
          source: String(row[idColumn]),
          target: String(row[targetColumn]),
          relationship,
          properties: {},
          ...(resolvedLineage && { _lineage: resolvedLineage }),
        }))
    : [];

  return { nodes, edges };
}
