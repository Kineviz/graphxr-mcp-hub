/**
 * Unified Graph Semantic Layer — TypeScript Types & Zod Schemas
 *
 * All data sources (CSV, JSON, Neo4j, Spanner, HTTP API…) are converted
 * to these canonical types before being pushed to GraphXR.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Core graph types
// ---------------------------------------------------------------------------

export const GraphNodeSchema = z.object({
  id: z.string(),
  category: z.string(),
  properties: z.record(z.unknown()).default({}),
});

export const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  relationship: z.string(),
  properties: z.record(z.unknown()).default({}),
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
