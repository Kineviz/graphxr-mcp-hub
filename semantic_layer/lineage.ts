/**
 * Data Lineage Tracking
 *
 * Tracks the provenance of graph data — which data source, operation,
 * and timestamp produced each node/edge in the graph.
 */

import { GraphData, GraphNode, GraphEdge } from './graph_schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LineageMetadata {
  /** Data source identifier (e.g., "csv:data/sample.csv", "neo4j:bolt://...", "kafka:topic-name") */
  source: string;
  /** Operation that produced this data (e.g., "push_graph", "add_nodes") */
  operation: string;
  /** ISO 8601 timestamp of when the data was ingested */
  timestamp: string;
  /** Unique operation ID for correlating nodes/edges from the same operation */
  operationId: string;
}

export interface LineageRecord {
  operationId: string;
  operation: string;
  source: string;
  timestamp: string;
  nodeCount: number;
  edgeCount: number;
}

// ---------------------------------------------------------------------------
// Lineage helpers
// ---------------------------------------------------------------------------

let operationCounter = 0;

/** Generate a unique operation ID. */
export function generateOperationId(): string {
  return `op_${Date.now()}_${++operationCounter}`;
}

/**
 * Attach lineage metadata to every node and edge in a GraphData object.
 * Metadata is stored under `properties._lineage` so it doesn't collide
 * with user-defined properties.
 */
export function attachLineage(data: GraphData, lineage: LineageMetadata): GraphData {
  const tagNode = (node: GraphNode): GraphNode => ({
    ...node,
    properties: { ...node.properties, _lineage: lineage },
  });

  const tagEdge = (edge: GraphEdge): GraphEdge => ({
    ...edge,
    properties: { ...edge.properties, _lineage: lineage },
  });

  return {
    nodes: data.nodes.map(tagNode),
    edges: data.edges.map(tagEdge),
  };
}

/** Extract lineage metadata from a node or edge, if present. */
export function extractLineage(entity: GraphNode | GraphEdge): LineageMetadata | null {
  const lineage = entity.properties._lineage;
  if (lineage && typeof lineage === 'object') {
    return lineage as LineageMetadata;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lineage Tracker — in-memory operation log
// ---------------------------------------------------------------------------

export class LineageTracker {
  private records: LineageRecord[] = [];
  private readonly maxRecords: number;

  constructor(maxRecords = 1000) {
    this.maxRecords = maxRecords;
  }

  /** Record a data operation. */
  record(entry: LineageRecord): void {
    this.records.push(entry);
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }

  /** Get the most recent operations (newest first). */
  getRecent(limit = 50): LineageRecord[] {
    return this.records.slice(-limit).reverse();
  }

  /** Get all operations for a specific source. */
  getBySource(source: string): LineageRecord[] {
    return this.records.filter((r) => r.source === source);
  }

  /** Get total operation count. */
  get count(): number {
    return this.records.length;
  }

  /** Clear all records. */
  clear(): void {
    this.records = [];
  }
}
