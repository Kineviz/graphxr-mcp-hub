/**
 * Tool: add_edges
 * Incrementally adds edges to the current GraphXR graph.
 */

import { z } from 'zod';
import { GraphXRClient } from '../graphxr_client.js';
import { GraphEdgeSchema } from '../../semantic_layer/graph_schema.js';

const AddEdgesArgsSchema = z.object({
  edges: z.array(GraphEdgeSchema),
});

export async function addEdges(
  client: GraphXRClient,
  args: unknown
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { edges } = AddEdgesArgsSchema.parse(args);
  await client.addEdges(edges);
  return {
    content: [
      {
        type: 'text',
        text: `Added ${edges.length} edge(s) to GraphXR.`,
      },
    ],
  };
}
