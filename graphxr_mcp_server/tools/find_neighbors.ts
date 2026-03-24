/**
 * Tool: find_neighbors
 * Returns all nodes and edges directly connected to the specified node.
 */

import { z } from 'zod';
import { GraphXRClient } from '../graphxr_client.js';

const FindNeighborsArgsSchema = z.object({
  node_id: z.string(),
});

export async function findNeighbors(
  client: GraphXRClient,
  args: unknown
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { node_id } = FindNeighborsArgsSchema.parse(args);
  const result = await client.findNeighbors(node_id);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
