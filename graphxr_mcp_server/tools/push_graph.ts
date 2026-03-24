/**
 * Tool: push_graph
 * Replaces the entire graph in GraphXR with the supplied nodes and edges.
 */

import { z } from 'zod';
import { GraphXRClient } from '../graphxr_client.js';
import { GraphNodeSchema, GraphEdgeSchema } from '../../semantic_layer/graph_schema.js';

const PushGraphArgsSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});

export async function pushGraph(
  client: GraphXRClient,
  args: unknown
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { nodes, edges } = PushGraphArgsSchema.parse(args);
  await client.pushGraph({ nodes, edges });
  return {
    content: [
      {
        type: 'text',
        text: `Graph pushed to GraphXR: ${nodes.length} node(s), ${edges.length} edge(s).`,
      },
    ],
  };
}
