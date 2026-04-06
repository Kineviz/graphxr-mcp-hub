/**
 * Tool: add_edges
 * Incrementally adds edges to the current GraphXR graph.
 */

import { z } from 'zod';
import { IGraphXRClient } from '../graphxr_bridge';
import { GraphEdgeSchema } from '../../semantic_layer/graph_schema';
import { generateOperationId, LineageTracker } from '../../semantic_layer/lineage';

const AddEdgesArgsSchema = z.object({
  edges: z.array(GraphEdgeSchema),
  source: z.string().optional(),
});

export async function addEdges(
  client: IGraphXRClient,
  args: unknown,
  lineageTracker?: LineageTracker
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { edges, source } = AddEdgesArgsSchema.parse(args);
  const operationId = generateOperationId();
  const lineage = {
    source: source ?? 'mcp-client',
    operation: 'add_edges',
    timestamp: new Date().toISOString(),
    operationId,
  };
  await client.addEdges(edges);
  lineageTracker?.record({ ...lineage, nodeCount: 0, edgeCount: edges.length });
  return {
    content: [
      {
        type: 'text',
        text: `Added ${edges.length} edge(s) to GraphXR. [${operationId}]`,
      },
    ],
  };
}
