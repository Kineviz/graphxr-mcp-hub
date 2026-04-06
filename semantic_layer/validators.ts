/**
 * Data validators — runtime type-checking helpers
 * built on top of the Zod schemas in graph_schema.ts.
 */

import { GraphDataSchema, GraphNodeSchema, GraphEdgeSchema, GraphData, GraphNode, GraphEdge } from './graph_schema';

export function validateGraphData(data: unknown): GraphData {
  return GraphDataSchema.parse(data);
}

export function validateNode(node: unknown): GraphNode {
  return GraphNodeSchema.parse(node);
}

export function validateEdge(edge: unknown): GraphEdge {
  return GraphEdgeSchema.parse(edge);
}

export function isValidGraphData(data: unknown): data is GraphData {
  return GraphDataSchema.safeParse(data).success;
}
