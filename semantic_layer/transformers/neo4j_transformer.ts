/**
 * Neo4j transformer
 * Converts Neo4j query results (nodes + relationships) into GraphData.
 */

import { GraphData, GraphNode, GraphEdge } from '../graph_schema';

interface Neo4jNode {
  identity: { low: number };
  labels: string[];
  properties: Record<string, unknown>;
}

interface Neo4jRelationship {
  identity: { low: number };
  start: { low: number };
  end: { low: number };
  type: string;
  properties: Record<string, unknown>;
}

export function neo4jResultToGraph(
  records: Array<{ keys: string[]; _fields: unknown[] }>
): GraphData {
  const nodesMap = new Map<string, GraphNode>();
  const edgesMap = new Map<string, GraphEdge>();

  for (const record of records) {
    for (const field of record._fields) {
      if (isNeo4jNode(field)) {
        const id = String(field.identity.low);
        if (!nodesMap.has(id)) {
          nodesMap.set(id, {
            id,
            category: field.labels[0] ?? 'Node',
            properties: field.properties,
          });
        }
      } else if (isNeo4jRelationship(field)) {
        const id = String(field.identity.low);
        if (!edgesMap.has(id)) {
          edgesMap.set(id, {
            id,
            source: String(field.start.low),
            target: String(field.end.low),
            relationship: field.type,
            properties: field.properties,
          });
        }
      }
    }
  }

  return {
    nodes: Array.from(nodesMap.values()),
    edges: Array.from(edgesMap.values()),
  };
}

function isNeo4jNode(value: unknown): value is Neo4jNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'labels' in value &&
    'properties' in value &&
    'identity' in value
  );
}

function isNeo4jRelationship(value: unknown): value is Neo4jRelationship {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'start' in value &&
    'end' in value &&
    !('labels' in value)
  );
}
