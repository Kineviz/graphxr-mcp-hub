/**
 * Tool: update_node
 * Merges new properties into an existing node in the GraphXR graph.
 */

import { z } from 'zod';
import { GraphXRClient } from '../graphxr_client.js';

const UpdateNodeArgsSchema = z.object({
  id: z.string(),
  properties: z.record(z.unknown()),
});

export async function updateNode(
  client: GraphXRClient,
  args: unknown
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { id, properties } = UpdateNodeArgsSchema.parse(args);
  await client.updateNode(id, properties);
  return {
    content: [
      {
        type: 'text',
        text: `Node "${id}" updated in GraphXR.`,
      },
    ],
  };
}
