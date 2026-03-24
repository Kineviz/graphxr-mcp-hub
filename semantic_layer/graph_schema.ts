/**
 * Unified Graph Semantic Layer — TypeScript Types & Zod Schemas
 *
 * All data sources (CSV, JSON, Neo4j, Spanner, HTTP API…) are converted
 * to these canonical types before being pushed to GraphXR.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Lineage — tracks which data source a node/edge came from
// ---------------------------------------------------------------------------

export const LineageSchema = z.object({
  /** Human-readable source name, e.g. "duckdb", "neo4j", "http-api". */
  source: z.string(),
  /** File path or URL, e.g. "/data/users.csv", "s3://bucket/file.parquet". */
  file: z.string().optional(),
  /** The query that produced this record (SQL, Cypher, URL path, etc.). */
  query: z.string().optional(),
  /** ISO 8601 timestamp of when the data was fetched. */
  fetchedAt: z.string(),
});

export type Lineage = z.infer<typeof LineageSchema>;

// ---------------------------------------------------------------------------
// Core graph types
// ---------------------------------------------------------------------------

export const GraphNodeSchema = z.object({
  id: z.string(),
  category: z.string(),
  properties: z.record(z.unknown()).default({}),
  /** Optional lineage metadata — which data source this node came from. */
  _lineage: LineageSchema.optional(),
});

export const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  relationship: z.string(),
  properties: z.record(z.unknown()).default({}),
  /** Optional lineage metadata — which data source this edge came from. */
  _lineage: LineageSchema.optional(),
});

export const GraphDataSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});

export const GraphStateSchema = z.object({
  nodeCount: z.number(),
  edgeCount: z.number(),
  categories: z.record(z.number()),
  relationships: z.record(z.number()),
});

export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type GraphData = z.infer<typeof GraphDataSchema>;
export type GraphState = z.infer<typeof GraphStateSchema>;

// ---------------------------------------------------------------------------
// Lineage helper — build a Lineage object for a given source
// ---------------------------------------------------------------------------

export function makeLineage(
  source: string,
  extras: Omit<Lineage, 'source' | 'fetchedAt'> = {}
): Lineage {
  return { source, fetchedAt: new Date().toISOString(), ...extras };
}
