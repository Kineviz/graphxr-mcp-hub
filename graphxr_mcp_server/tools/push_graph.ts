/**
 * Tool: push_graph
 * Replaces the entire graph in GraphXR with the supplied nodes and edges.
 */

import { z } from 'zod';
import { IGraphXRClient } from '../graphxr_bridge';
import { GraphNodeSchema, GraphEdgeSchema } from '../../semantic_layer/graph_schema';
import { attachLineage, generateOperationId, LineageTracker } from '../../semantic_layer/lineage';

const PushGraphArgsSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  source: z.string().optional(),
});

export async function pushGraph(
  client: IGraphXRClient,
  args: unknown,
  lineageTracker?: LineageTracker
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { nodes, edges, source } = PushGraphArgsSchema.parse(args);
  const operationId = generateOperationId();
  const lineage = {
    source: source ?? 'mcp-client',
    operation: 'push_graph',
    timestamp: new Date().toISOString(),
    operationId,
  };
  const tagged = attachLineage({ nodes, edges }, lineage);
  await client.pushGraph(tagged);
  lineageTracker?.record({ ...lineage, nodeCount: nodes.length, edgeCount: edges.length });
  return {
    content: [
      {
        type: 'text',
        text: `Graph pushed to GraphXR: ${nodes.length} node(s), ${edges.length} edge(s). [${operationId}]`,
      },
    ],
  };
}
