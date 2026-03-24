/**
 * Tool: add_nodes
 * Incrementally adds nodes to the current GraphXR graph.
 */

import { z } from 'zod';
import { GraphXRClient } from '../graphxr_client.js';
import { GraphNodeSchema } from '../../semantic_layer/graph_schema.js';

const AddNodesArgsSchema = z.object({
  nodes: z.array(GraphNodeSchema),
});

export async function addNodes(
  client: GraphXRClient,
  args: unknown
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { nodes } = AddNodesArgsSchema.parse(args);
  await client.addNodes(nodes);
  return {
    content: [
      {
        type: 'text',
        text: `Added ${nodes.length} node(s) to GraphXR.`,
      },
    ],
  };
}
